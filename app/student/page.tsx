'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'

type StudentState = 'idle' | 'connecting' | 'active' | 'error'

// Full WebSocket URL (includes /ws path)
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws'

export default function StudentPage() {
  const [state, setState] = useState<StudentState>('idle')
  const [codeInput, setCodeInput] = useState('')
  const [connectedCode, setConnectedCode] = useState('')
  const [subtitles, setSubtitles] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [lessonEnded, setLessonEnded] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const stateRef = useRef<StudentState>('idle')
  const lessonEndedRef = useRef(false)
  const subtitlesEndRef = useRef<HTMLDivElement>(null)

  const setStateSynced = useCallback((s: StudentState) => {
    stateRef.current = s
    setState(s)
  }, [])

  // Auto-scroll when new subtitle arrives
  useEffect(() => {
    subtitlesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [subtitles])

  useEffect(() => () => { wsRef.current?.close() }, [])

  const connect = useCallback(() => {
    if (!/^\d{6}$/.test(codeInput)) {
      setErrorMsg('Введите ровно 6 цифр')
      return
    }
    setErrorMsg('')
    setStateSynced('connecting')
    setSubtitles([])
    lessonEndedRef.current = false
    setLessonEnded(false)

    console.log(`[WS] Connecting to ${WS_URL}`)
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log(`[WS] Connected, registering as student with code ${codeInput}`)
      ws.send(JSON.stringify({ type: 'register', role: 'student', code: codeInput }))
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>

        if (msg.type === 'joined') {
          console.log(`[WS] Joined room ${codeInput}`)
          setConnectedCode(codeInput)
          setStateSynced('active')

        } else if (msg.type === 'error') {
          console.log(`[WS] Error: ${String(msg.message)}`)
          setErrorMsg(String(msg.message ?? 'Ошибка подключения'))
          setStateSynced('error')
          // Null handlers before close so onclose doesn't override our error state
          ws.onclose = null
          ws.close()
          wsRef.current = null

        } else if (msg.type === 'transcript') {
          const text = String(msg.text ?? '')
          console.log(`[WS] Transcript: ${text}`)
          setSubtitles(prev => [...prev, text])

        } else if (msg.type === 'room_closed') {
          console.log('[WS] Room closed by teacher')
          lessonEndedRef.current = true
          setLessonEnded(true)
        }
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      console.log('[WS] Connection closed')
      wsRef.current = null
      if (!lessonEndedRef.current && (stateRef.current === 'active' || stateRef.current === 'connecting')) {
        const msg = stateRef.current === 'connecting'
          ? 'Не удалось подключиться к серверу'
          : 'Соединение прервано'
        setStateSynced('error')
        setErrorMsg(msg)
      }
    }

    ws.onerror = () => {
      // onclose fires right after; let it handle the state update
    }
  }, [codeInput, setStateSynced])

  const disconnect = useCallback(() => {
    console.log('[WS] Disconnecting')
    if (wsRef.current) {
      const ws = wsRef.current
      wsRef.current = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      ws.close()
    }
    stateRef.current = 'idle'
    setState('idle')
    setSubtitles([])
    setConnectedCode('')
    lessonEndedRef.current = false
    setLessonEnded(false)
  }, [])

  const retry = useCallback(() => {
    stateRef.current = 'idle'
    setState('idle')
    setErrorMsg('')
  }, [])

  // ── Idle ───────────────────────────────────────────────────────────────────
  if (state === 'idle') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-white dark:bg-gray-950">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <Link href="/" className="text-blue-600 hover:underline text-sm block mb-3">
              ← На главную
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Студент</h1>
          </div>

          <div className="space-y-3">
            <label
              htmlFor="code-input"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Код урока
            </label>
            <input
              id="code-input"
              type="tel"
              inputMode="numeric"
              maxLength={6}
              value={codeInput}
              onChange={e => {
                setCodeInput(e.target.value.replace(/\D/g, ''))
                setErrorMsg('')
              }}
              onKeyDown={e => e.key === 'Enter' && connect()}
              placeholder="123456"
              className="w-full text-4xl font-mono text-center py-4 px-4 border-2 border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-white tracking-widest focus:outline-none focus:border-blue-500 transition-colors"
            />
            {errorMsg && (
              <p className="text-sm text-red-600 text-center">{errorMsg}</p>
            )}
            <button
              onClick={connect}
              disabled={codeInput.length !== 6}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-400 text-white text-lg font-medium rounded-xl transition-colors"
            >
              Подключиться
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Connecting ─────────────────────────────────────────────────────────────
  if (state === 'connecting') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 dark:text-gray-400">Подключение...</p>
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
        </div>
      </main>
    )
  }

  // ── Active (subtitles view) ────────────────────────────────────────────────
  return (
    <main className="min-h-screen flex flex-col bg-gray-950">
      <header className="sticky top-0 flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          {lessonEnded ? (
            <span className="text-sm text-gray-400 font-medium">Урок завершён</span>
          ) : (
            <>
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm text-gray-300 font-medium">
                Подключено #{connectedCode}
              </span>
            </>
          )}
        </div>
        <button
          onClick={disconnect}
          className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1 rounded-lg hover:bg-gray-800"
        >
          Отключиться
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-8 space-y-6">
        {subtitles.length === 0 && !lessonEnded && (
          <p className="text-center text-gray-500 text-2xl mt-16">
            Ожидание преподавателя...
          </p>
        )}

        {subtitles.map((line, i) => (
          <p
            key={i}
            className="text-3xl md:text-4xl font-medium leading-relaxed text-white"
          >
            {line}
          </p>
        ))}

        {lessonEnded && (
          <p className="text-center text-gray-500 text-xl pt-6 border-t border-gray-800">
            — Урок завершён —
          </p>
        )}

        <div ref={subtitlesEndRef} />
      </div>
    </main>
  )
}
