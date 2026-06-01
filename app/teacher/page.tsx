'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { Signal, SignalType } from '../types'

type LessonState = 'idle' | 'connecting' | 'active' | 'stopped' | 'error'
type Language = 'ru-RU' | 'kk-KZ' | 'en-US'

const LANGUAGE_LABELS: Record<Language, string> = {
  'ru-RU': 'Русский',
  'kk-KZ': 'Қазақша',
  'en-US': 'English',
}

const SIGNAL_CONFIG: Record<SignalType, { icon: string; label: string; bg: string }> = {
  confused:    { icon: '🤔', label: 'Не понял',   bg: 'bg-amber-500'   },
  repeat:      { icon: '🔁', label: 'Повторите',  bg: 'bg-blue-500'    },
  slow:        { icon: '⏸', label: 'Медленнее',  bg: 'bg-violet-500'  },
  question:    { icon: '❓', label: 'Вопрос',     bg: 'bg-red-500'     },
  understood:  { icon: '✓',  label: 'Понятно',    bg: 'bg-emerald-500' },
}

const VALID_SIGNAL_TYPES: SignalType[] = ['confused', 'repeat', 'slow', 'question', 'understood']

function playBeep(): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.15)
  } catch { /* audio unavailable */ }
}

function formatTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000)
  if (diffSec < 60) return 'сейчас'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`
  return `${Math.floor(diffSec / 3600)} ч назад`
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws'

export default function TeacherPage() {
  const [state, setState] = useState<LessonState>('idle')
  const [language, setLanguage] = useState<Language>('ru-RU')
  const [code, setCode] = useState('')
  const [transcript, setTranscript] = useState('')
  const [connected, setConnected] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const [signals, setSignals] = useState<Signal[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [toast, setToast] = useState<Signal | null>(null)
  const [signalPanelOpen, setSignalPanelOpen] = useState(false)
  // tick forces re-render every 30s so relative timestamps stay fresh
  const [, setTick] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const isLiveRef = useRef(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  useEffect(() => () => {
    stopAll()
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [stopAll])

  // keep relative timestamps fresh
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

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
    setSignals([])
    setUnreadCount(0)
    setToast(null)
    setSignalPanelOpen(false)
    setState('connecting')

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', role: 'teacher', code: roomCode }))
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>

        if (msg.type === 'registered') {
          isLiveRef.current = true
          setState('active')
          setConnected(true)

          const recognition = new SpeechAPI()
          recognition.lang = language
          recognition.continuous = true
          recognition.interimResults = true
          recognitionRef.current = recognition

          recognition.onresult = (evt: SpeechRecognitionEvent) => {
            for (let i = evt.resultIndex; i < evt.results.length; i++) {
              if (evt.results[i].isFinal) {
                const text = evt.results[i][0].transcript.trim()
                if (!text) continue
                setTranscript(prev => prev + text + ' ')
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'transcript', code: roomCode, text }))
                }
              }
            }
          }

          recognition.onerror = (evt: SpeechRecognitionErrorEvent) => {
            if (evt.error !== 'no-speech') console.log(`[Speech] Error: ${evt.error}`)
          }

          recognition.onend = () => {
            if (isLiveRef.current) {
              try { recognition.start() } catch { /* already restarting */ }
            }
          }

          recognition.start()

        } else if (msg.type === 'error') {
          stopAll()
          setState('error')
          setErrorMsg(String(msg.message ?? 'Ошибка сервера'))

        } else if (msg.type === 'signal') {
          const signalType = msg.signalType as SignalType
          if (!VALID_SIGNAL_TYPES.includes(signalType)) return

          const newSignal: Signal = {
            id: crypto.randomUUID(),
            type: signalType,
            timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
            studentId: String(msg.studentId ?? ''),
          }

          setSignals(prev => [newSignal, ...prev].slice(0, 10))
          setUnreadCount(prev => prev + 1)

          if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
          setToast(newSignal)
          toastTimerRef.current = setTimeout(() => setToast(null), 3000)

          playBeep()
        }
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      setConnected(false)
      if (wsRef.current === ws) {
        stopAll()
        setState('error')
        setErrorMsg('Соединение с сервером прервано')
      }
    }

    ws.onerror = () => {
      setConnected(false)
      if (wsRef.current === ws) {
        stopAll()
        setState('error')
        setErrorMsg('Не удалось подключиться к серверу')
      }
    }
  }, [stopAll, language])

  const stopLesson = useCallback(() => {
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
    setSignals([])
    setUnreadCount(0)
    setToast(null)
  }, [stopAll])

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }, [code])

  const clearSignals = () => {
    setSignals([])
    setUnreadCount(0)
  }

  // ── Idle / Stopped ─────────────────────────────────────────────────────────
  if (state === 'idle' || state === 'stopped') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-white dark:bg-gray-950">
        <div className="text-center space-y-6">
          <Link href="/" className="text-blue-600 hover:underline text-sm">
            ← На главную
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Преподаватель</h1>
          <div className="space-y-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">Язык урока</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              {(['ru-RU', 'kk-KZ', 'en-US'] as const).map(lang => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
                    language === lang
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-400 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-500'
                  }`}
                >
                  {LANGUAGE_LABELS[lang]}
                </button>
              ))}
            </div>
          </div>
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

  // ── Connecting ─────────────────────────────────────────────────────────────
  if (state === 'connecting') {
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
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Код урока</span>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-sm text-gray-600 dark:text-gray-300">Подключение...</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-5xl font-mono font-bold text-gray-900 dark:text-white tracking-widest">{code}</span>
            <button onClick={copyCode} className="px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 rounded-lg transition-colors">
              {copied ? '✓ Скопировано' : 'Копировать'}
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 min-h-64">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Транскрипт</p>
          <p className="text-gray-400 italic">Говорите — текст появится здесь...</p>
        </div>
      </main>
    )
  }

  // ── Active ─────────────────────────────────────────────────────────────────
  const signalList = (
    <>
      {signals.length === 0 ? (
        <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-8 px-4">
          Нет сигналов
        </p>
      ) : (
        signals.map(sig => {
          const cfg = SIGNAL_CONFIG[sig.type]
          return (
            <div key={sig.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <span className={`w-8 h-8 flex items-center justify-center rounded-full text-white text-sm shrink-0 ${cfg.bg}`}>
                {cfg.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  Студент: {cfg.label}
                </p>
                <p className="text-xs text-gray-400">{formatTime(sig.timestamp)}</p>
              </div>
            </div>
          )
        })
      )}
    </>
  )

  return (
    <>
      {/* Main content */}
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
              <span className={`w-2 h-2 rounded-full transition-colors ${connected ? 'bg-green-500' : 'bg-yellow-400'}`} />
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {connected ? 'Подключено' : 'Нет связи'}
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

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-red-500">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium">Идёт запись</span>
            </div>
            <p className="text-xs text-gray-400 pl-4">Язык: {LANGUAGE_LABELS[language]}</p>
          </div>
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

      {/* Desktop signal panel — fixed right sidebar */}
      <aside className="hidden md:flex fixed top-0 right-0 bottom-0 w-72 flex-col bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 z-20">
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Сигналы от студентов
          </span>
          {unreadCount > 0 && (
            <span className="bg-blue-600 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[22px] text-center">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {signalList}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <button
            onClick={clearSignals}
            className="w-full text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors py-1"
          >
            Очистить
          </button>
        </div>
      </aside>

      {/* Mobile: floating toggle button */}
      <div className="md:hidden fixed bottom-4 right-4 z-40">
        <button
          onClick={() => setSignalPanelOpen(v => !v)}
          className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-full shadow-lg transition-colors"
        >
          <span>📥</span>
          <span className="text-sm">
            Сигналы{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </span>
        </button>
      </div>

      {/* Mobile: signal panel (bottom sheet) */}
      {signalPanelOpen && (
        <div className="md:hidden fixed bottom-16 left-0 right-0 z-30 bg-white dark:bg-gray-900 rounded-t-2xl border-t border-gray-200 dark:border-gray-700 shadow-2xl max-h-72 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Сигналы от студентов
              {unreadCount > 0 && (
                <span className="ml-2 bg-blue-600 text-white text-xs font-bold rounded-full px-2 py-0.5">
                  {unreadCount}
                </span>
              )}
            </span>
            <button
              onClick={() => setSignalPanelOpen(false)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {signalList}
          </div>
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
            <button
              onClick={() => { clearSignals(); setSignalPanelOpen(false) }}
              className="w-full text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              Очистить
            </button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          role="alert"
          onClick={() => setToast(null)}
          className={[
            'fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl cursor-pointer',
            'text-white transition-all',
            SIGNAL_CONFIG[toast.type].bg,
          ].join(' ')}
        >
          <span className="text-xl">{SIGNAL_CONFIG[toast.type].icon}</span>
          <div>
            <p className="font-medium text-sm">Студент: {SIGNAL_CONFIG[toast.type].label}</p>
          </div>
        </div>
      )}
    </>
  )
}
