'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { SignalType } from '../types'

type StudentState = 'idle' | 'connecting' | 'active' | 'error'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws'

const SIGNALS: Array<{ type: SignalType; icon: string; label: string; color: string }> = [
  { type: 'confused',    icon: '🤔', label: 'Не понял',  color: 'bg-amber-500  active:bg-amber-600'   },
  { type: 'repeat',     icon: '🔁', label: 'Повторите', color: 'bg-blue-500   active:bg-blue-600'    },
  { type: 'slow',       icon: '⏸', label: 'Медленнее', color: 'bg-violet-500 active:bg-violet-600'  },
  { type: 'question',   icon: '❓', label: 'Вопрос',    color: 'bg-red-500    active:bg-red-600'     },
  { type: 'understood', icon: '✓',  label: 'Понятно',   color: 'bg-emerald-500 active:bg-emerald-600'},
]

const MAX_QUESTION_LEN = 500

export default function StudentPage() {
  const [state, setState] = useState<StudentState>('idle')
  const [codeInput, setCodeInput] = useState('')
  const [connectedCode, setConnectedCode] = useState('')
  const [subtitles, setSubtitles] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [lessonEnded, setLessonEnded] = useState(false)

  // Quick-signal state
  const [signalCooldown, setSignalCooldown] = useState(false)
  const [lastSignal, setLastSignal] = useState<SignalType | null>(null)

  // Question panel state
  const [questionOpen, setQuestionOpen] = useState(false)
  const [questionText, setQuestionText] = useState('')
  const [questionSent, setQuestionSent] = useState(false)
  const [questionCooldown, setQuestionCooldown] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const stateRef = useRef<StudentState>('idle')
  const lessonEndedRef = useRef(false)
  const subtitlesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const setStateSynced = useCallback((s: StudentState) => {
    stateRef.current = s
    setState(s)
  }, [])

  useEffect(() => {
    subtitlesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [subtitles])

  useEffect(() => () => { wsRef.current?.close() }, [])

  const resetQuestionState = useCallback(() => {
    setQuestionOpen(false)
    setQuestionText('')
    setQuestionSent(false)
    setQuestionCooldown(false)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [])

  const connect = useCallback(() => {
    if (!/^\d{6}$/.test(codeInput)) {
      setErrorMsg('Введите ровно 6 цифр')
      return
    }
    setErrorMsg('')
    setStateSynced('connecting')
    setSubtitles([])
    setSignalCooldown(false)
    setLastSignal(null)
    resetQuestionState()
    lessonEndedRef.current = false
    setLessonEnded(false)

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', role: 'student', code: codeInput }))
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>
        if (msg.type === 'joined') {
          setConnectedCode(codeInput)
          setStateSynced('active')
        } else if (msg.type === 'error') {
          setErrorMsg(String(msg.message ?? 'Ошибка подключения'))
          setStateSynced('error')
          ws.onclose = null
          ws.close()
          wsRef.current = null
        } else if (msg.type === 'transcript') {
          setSubtitles(prev => [...prev, String(msg.text ?? '')])
        } else if (msg.type === 'room_closed') {
          lessonEndedRef.current = true
          setLessonEnded(true)
        }
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!lessonEndedRef.current && (stateRef.current === 'active' || stateRef.current === 'connecting')) {
        const m = stateRef.current === 'connecting'
          ? 'Не удалось подключиться к серверу'
          : 'Соединение прервано'
        setStateSynced('error')
        setErrorMsg(m)
      }
    }

    ws.onerror = () => { /* onclose handles it */ }
  }, [codeInput, setStateSynced, resetQuestionState])

  const disconnect = useCallback(() => {
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
    setSignalCooldown(false)
    setLastSignal(null)
    resetQuestionState()
    lessonEndedRef.current = false
    setLessonEnded(false)
  }, [resetQuestionState])

  const retry = useCallback(() => {
    stateRef.current = 'idle'
    setState('idle')
    setErrorMsg('')
    setSignalCooldown(false)
    setLastSignal(null)
    resetQuestionState()
  }, [resetQuestionState])

  const sendSignal = useCallback((signalType: SignalType) => {
    if (signalCooldown || lessonEnded || !wsRef.current) return
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100)
    setSignalCooldown(true)
    setLastSignal(signalType)
    wsRef.current.send(JSON.stringify({ type: 'signal', code: connectedCode, signalType }))
    setTimeout(() => {
      setSignalCooldown(false)
      setLastSignal(null)
    }, 2000)
  }, [signalCooldown, lessonEnded, connectedCode])

  const sendQuestion = useCallback(() => {
    const text = questionText.trim()
    if (!text || questionCooldown || lessonEnded || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'question', code: connectedCode, text }))
    setQuestionText('')
    setQuestionOpen(false)
    setQuestionSent(true)
    setQuestionCooldown(true)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setTimeout(() => {
      setQuestionSent(false)
      setQuestionCooldown(false)
    }, 3000)
  }, [questionText, questionCooldown, lessonEnded, connectedCode])

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

  // ── Active ─────────────────────────────────────────────────────────────────
  // Bottom panel height: signals ~80px + toggle ~36px + textarea area ~148px (when open)
  const bottomPadding = questionOpen ? 280 : 130

  return (
    <main className="min-h-screen flex flex-col bg-gray-950">
      <header className="sticky top-0 flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 z-10">
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

      {/* Subtitles scroll area */}
      <div
        className="flex-1 overflow-y-auto px-5 py-8 space-y-6"
        style={{ paddingBottom: `${bottomPadding}px` }}
      >
        {subtitles.length === 0 && !lessonEnded && (
          <p className="text-center text-gray-500 text-2xl mt-16">
            Ожидание преподавателя...
          </p>
        )}
        {subtitles.map((line, i) => (
          <p key={i} className="text-3xl md:text-4xl font-medium leading-relaxed text-white">
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

      {/* Fixed bottom panel */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900/95 backdrop-blur-sm border-t border-gray-800">

        {/* Question textarea — shown when open */}
        {questionOpen && (
          <div className="px-3 pt-3 pb-2 border-b border-gray-800">
            <div className="max-w-2xl mx-auto">
              <textarea
                ref={textareaRef}
                value={questionText}
                onChange={e => {
                  setQuestionText(e.target.value)
                  const ta = e.target
                  ta.style.height = 'auto'
                  ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    sendQuestion()
                  }
                }}
                placeholder="Напишите ваш вопрос преподавателю..."
                maxLength={MAX_QUESTION_LEN}
                rows={3}
                className="w-full bg-gray-800 text-white text-base rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                style={{ minHeight: '80px', maxHeight: '160px' }}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-500">
                  {questionText.length} / {MAX_QUESTION_LEN}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setQuestionOpen(false); setQuestionText('') }}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-800"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={sendQuestion}
                    disabled={!questionText.trim() || questionCooldown || lessonEnded}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
                  >
                    Отправить
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toggle row */}
        <div className="max-w-2xl mx-auto px-3 py-2 border-b border-gray-800">
          {questionSent ? (
            <p className="text-center text-sm text-green-400 font-medium py-0.5">
              ✅ Отправлено!
            </p>
          ) : (
            <button
              onClick={() => !lessonEnded && setQuestionOpen(v => !v)}
              disabled={lessonEnded}
              className="w-full text-sm text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors py-0.5 flex items-center justify-center gap-1.5"
            >
              <span>✍</span>
              <span>{questionOpen ? 'Свернуть' : 'Написать вопрос'}</span>
            </button>
          )}
        </div>

        {/* Signal buttons */}
        <div className="px-2 py-2">
          <div className="grid grid-cols-5 gap-1 max-w-2xl mx-auto">
            {SIGNALS.map(({ type, icon, label, color }) => {
              const sent = lastSignal === type
              return (
                <button
                  key={type}
                  onClick={() => sendSignal(type)}
                  disabled={signalCooldown || lessonEnded}
                  className={[
                    'flex flex-col items-center justify-center gap-0.5',
                    'min-h-[64px] rounded-xl text-white font-medium',
                    'transition-transform duration-100 active:scale-95',
                    color,
                    signalCooldown || lessonEnded ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
                  ].join(' ')}
                >
                  <span className="text-2xl leading-none">{icon}</span>
                  <span className="text-[10px] leading-tight text-center px-0.5">
                    {sent ? 'Отправлено' : label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

      </div>
    </main>
  )
}
