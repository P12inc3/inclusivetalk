'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'

type LessonState = 'idle' | 'connecting' | 'active' | 'stopped' | 'error'

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Full WebSocket URL (includes /ws path)
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws'

export default function TeacherPage() {
  const [state, setState] = useState<LessonState>('idle')
  const [code, setCode] = useState('')
  const [transcript, setTranscript] = useState('')
  const [connected, setConnected] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  // true while the lesson is live; checked inside WS/speech callbacks
  const isLiveRef = useRef(false)

  const stopAll = useCallback(() => {
    isLiveRef.current = false

    if (recognitionRef.current) {
      const r = recognitionRef.current
      recognitionRef.current = null
      r.onend = null
      r.onerror = null
      r.onresult = null
      try { r.stop() } catch { /* already stopped */ }
    }

    if (wsRef.current) {
      const ws = wsRef.current
      wsRef.current = null
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      ws.close()
    }
  }, [])

  useEffect(() => () => stopAll(), [stopAll])

  const startLesson = useCallback(() => {
    const SpeechAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SpeechAPI) {
      setState('error')
      setErrorMsg('Используйте Chrome или Edge — ваш браузер не поддерживает Web Speech API')
      return
    }

    const roomCode = generateCode()
    setCode(roomCode)
    setTranscript('')
    setConnected(false)
    setState('connecting')

    console.log(`[WS] Connecting to ${WS_URL}`)
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected, registering as teacher...')
      ws.send(JSON.stringify({ type: 'register', role: 'teacher', code: roomCode }))
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>

        if (msg.type === 'registered') {
          console.log(`[WS] Registered in room ${roomCode}`)
          isLiveRef.current = true
          setState('active')
          setConnected(true)

          // Start speech recognition after confirmed registration
          const recognition = new SpeechAPI()
          recognition.lang = 'ru-RU'
          recognition.continuous = true
          recognition.interimResults = true
          recognitionRef.current = recognition

          recognition.onresult = (evt: SpeechRecognitionEvent) => {
            for (let i = evt.resultIndex; i < evt.results.length; i++) {
              if (evt.results[i].isFinal) {
                const text = evt.results[i][0].transcript.trim()
                if (!text) continue
                console.log(`[Speech] Final: ${text}`)
                setTranscript(prev => prev + text + ' ')
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'transcript', code: roomCode, text }))
                }
              }
            }
          }

          recognition.onerror = (evt: SpeechRecognitionErrorEvent) => {
            if (evt.error !== 'no-speech') {
              console.log(`[Speech] Error: ${evt.error}`)
            }
          }

          recognition.onend = () => {
            if (isLiveRef.current) {
              console.log('[Speech] Restarting recognition')
              try { recognition.start() } catch { /* already restarting */ }
            }
          }

          console.log('[Speech] Starting recognition')
          recognition.start()

        } else if (msg.type === 'error') {
          console.log(`[WS] Error from server: ${String(msg.message)}`)
          stopAll()
          setState('error')
          setErrorMsg(String(msg.message ?? 'Ошибка сервера'))
        }
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      console.log('[WS] Connection closed')
      setConnected(false)
      if (wsRef.current === ws) {
        stopAll()
        setState('error')
        setErrorMsg('Соединение с сервером прервано')
      }
    }

    ws.onerror = () => {
      console.log('[WS] Connection error')
      setConnected(false)
      if (wsRef.current === ws) {
        stopAll()
        setState('error')
        setErrorMsg('Не удалось подключиться к серверу')
      }
    }
  }, [stopAll])

  const stopLesson = useCallback(() => {
    console.log('[WS] Stopping lesson')
    stopAll()
    setConnected(false)
    setState('stopped')
  }, [stopAll])

  const retry = useCallback(() => {
    stopAll()
    setState('idle')
    setCode('')
    setTranscript('')
    setErrorMsg('')
  }, [stopAll])

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }, [code])

  // ── Idle / Stopped ─────────────────────────────────────────────────────────
  if (state === 'idle' || state === 'stopped') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-white dark:bg-gray-950">
        <div className="text-center space-y-6">
          <Link href="/" className="text-blue-600 hover:underline text-sm">
            ← На главную
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Преподаватель</h1>
          <button
            onClick={startLesson}
            className="block mx-auto px-10 py-4 bg-blue-600 hover:bg-blue-700 text-white text-lg font-medium rounded-2xl transition-colors"
          >
            Начать урок
          </button>
        </div>
      </main>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-white dark:bg-gray-950">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-xl font-semibold text-red-600">Ошибка</p>
          <p className="text-gray-500 dark:text-gray-400">{errorMsg}</p>
          <button
            onClick={retry}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors"
          >
            Попробовать снова
          </button>
          <div>
            <Link href="/" className="text-blue-600 hover:underline text-sm">
              ← На главную
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ── Connecting / Active ────────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col px-4 py-6 max-w-2xl mx-auto bg-white dark:bg-gray-950">
      <div className="flex items-center justify-between mb-6">
        <span className="text-xl font-bold text-gray-900 dark:text-white">InclusiveTalk</span>
        <button
          onClick={stopLesson}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Завершить урок
        </button>
      </div>

      <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Код урока
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full transition-colors ${
                connected ? 'bg-green-500' : 'bg-yellow-400'
              }`}
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {state === 'connecting' ? 'Подключение...' : connected ? 'Подключено' : 'Нет связи'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-5xl font-mono font-bold text-gray-900 dark:text-white tracking-widest">
            {code}
          </span>
          <button
            onClick={copyCode}
            className="px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 rounded-lg transition-colors"
          >
            {copied ? '✓ Скопировано' : 'Копировать'}
          </button>
        </div>

        {state === 'active' && (
          <div className="flex items-center gap-2 text-red-500">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium">Идёт запись</span>
          </div>
        )}
      </div>

      <div className="flex-1 bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 min-h-64">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Транскрипт
        </p>
        {transcript ? (
          <p className="text-gray-800 dark:text-gray-200 text-lg leading-relaxed whitespace-pre-wrap">
            {transcript}
          </p>
        ) : (
          <p className="text-gray-400 italic">Говорите — текст появится здесь...</p>
        )}
      </div>
    </main>
  )
}
