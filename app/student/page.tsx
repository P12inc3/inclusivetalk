'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { SignalType } from '../types'
import ThemeToggle from '../components/ThemeToggle'
import { SIGNAL_LABELS, UI_LABELS, type Lang } from '../i18n'

type StudentState = 'idle' | 'connecting' | 'active' | 'error'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/ws'
const API_URL = WS_URL
  .replace(/^wss:\/\//, 'https://')
  .replace(/^ws:\/\//, 'http://')
  .replace(/\/ws$/, '')
const LS_NAME_KEY = 'inclusivetalk_student_name'
const LS_LANG_KEY = 'inclusivetalk_student_lang'

const SIGNALS: Array<{ type: SignalType; icon: string; color: string }> = [
  { type: 'confused',    icon: '🤔', color: 'bg-amber-500  active:bg-amber-600'   },
  { type: 'repeat',     icon: '🔁', color: 'bg-blue-500   active:bg-blue-600'    },
  { type: 'slow',       icon: '⏸', color: 'bg-violet-500 active:bg-violet-600'  },
  { type: 'question',   icon: '❓', color: 'bg-red-500    active:bg-red-600'     },
  { type: 'understood', icon: '✓',  color: 'bg-emerald-500 active:bg-emerald-600'},
]

const MAX_QUESTION_LEN = 500

const LANG_NAMES: Record<Lang, string> = {
  ru: 'Русский',
  kk: 'Қазақша',
  en: 'English',
}

export default function StudentPage() {
  const [state, setState] = useState<StudentState>('idle')
  const [studentLang, setStudentLang] = useState<Lang>('ru')
  const [nameInput, setNameInput] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [connectedCode, setConnectedCode] = useState('')
  const [connectedName, setConnectedName] = useState('')
  const [subtitles, setSubtitles] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [lessonEnded, setLessonEnded] = useState(false)

  const [signalCooldown, setSignalCooldown] = useState(false)
  const [lastSignal, setLastSignal] = useState<SignalType | null>(null)

  const [questionOpen, setQuestionOpen] = useState(false)
  const [questionText, setQuestionText] = useState('')
  const [questionSent, setQuestionSent] = useState(false)
  const [questionCooldown, setQuestionCooldown] = useState(false)

  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiQuestions, setAiQuestions] = useState<string[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiCooldown, setAiCooldown] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const stateRef = useRef<StudentState>('idle')
  const lessonEndedRef = useRef(false)
  const subtitlesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recentTranscriptRef = useRef<string[]>([])

  useEffect(() => {
    try {
      const savedName = localStorage.getItem(LS_NAME_KEY)
      if (savedName) setNameInput(savedName)
      const savedLang = localStorage.getItem(LS_LANG_KEY)
      if (savedLang && (savedLang === 'ru' || savedLang === 'kk' || savedLang === 'en')) {
        setStudentLang(savedLang)
      }
    } catch { /* localStorage unavailable */ }
  }, [])

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
    setAiPanelOpen(false)
    setAiQuestions([])
    setAiLoading(false)
    setAiCooldown(false)
    recentTranscriptRef.current = []
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [])

  const changeLang = useCallback((lang: Lang) => {
    setStudentLang(lang)
    try { localStorage.setItem(LS_LANG_KEY, lang) } catch { /* */ }
  }, [])

  const connect = useCallback(() => {
    const name = nameInput.trim()
    if (!name) {
      setErrorMsg('Введите ваше имя')
      return
    }
    if (!/^\d{6}$/.test(codeInput)) {
      setErrorMsg('Введите код урока (6 цифр)')
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
      ws.send(JSON.stringify({ type: 'register', role: 'student', code: codeInput, name }))
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>
        if (msg.type === 'joined') {
          try { localStorage.setItem(LS_NAME_KEY, name) } catch { /* */ }
          setConnectedCode(codeInput)
          setConnectedName(name)
          setStateSynced('active')
        } else if (msg.type === 'error') {
          setErrorMsg(String(msg.message ?? 'Ошибка подключения'))
          setStateSynced('error')
          ws.onclose = null
          ws.close()
          wsRef.current = null
        } else if (msg.type === 'transcript') {
          const text = String(msg.text ?? '')
          recentTranscriptRef.current = [...recentTranscriptRef.current, text].slice(-5)
          setSubtitles(prev => [...prev, text])
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
  }, [nameInput, codeInput, setStateSynced, resetQuestionState])

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
    setConnectedName('')
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

  const fetchAIQuestions = useCallback(async () => {
    if (aiCooldown || aiLoading || lessonEnded) return
    setAiLoading(true)
    setAiPanelOpen(true)
    setQuestionOpen(false)
    setAiQuestions([])
    try {
      const transcript = recentTranscriptRef.current.join(' ')
      const res = await fetch(`${API_URL}/api/generate-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, language: studentLang }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { questions?: string[] }
      setAiQuestions(Array.isArray(data.questions) ? data.questions : [])
    } catch {
      setAiQuestions([])
    } finally {
      setAiLoading(false)
      setAiCooldown(true)
      setTimeout(() => setAiCooldown(false), 10_000)
    }
  }, [aiCooldown, aiLoading, lessonEnded, studentLang])

  const t = UI_LABELS[studentLang]

  // ── Idle ───────────────────────────────────────────────────────────────────
  if (state === 'idle') {
    const canConnect = nameInput.trim().length > 0 && codeInput.length === 6
    return (
      <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logorb.svg" alt="InclusiveTalk" width={36} height={36} className="rounded-lg" />
            <span className="text-lg font-bold text-gray-900 dark:text-white">InclusiveTalk</span>
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t.student}</h1>
            </div>

            <div className="space-y-4">
              {/* Name input */}
              <div className="space-y-2">
                <label
                  htmlFor="name-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t.yourName}
                </label>
                <input
                  id="name-input"
                  type="text"
                  maxLength={50}
                  value={nameInput}
                  onChange={e => {
                    setNameInput(e.target.value)
                    setErrorMsg('')
                  }}
                  onKeyDown={e => e.key === 'Enter' && connect()}
                  placeholder={t.nameExample}
                  className="w-full text-xl py-3 px-4 border-2 border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500 transition-colors"
                  autoComplete="name"
                />
              </div>

              {/* Language picker */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Язык интерфейса
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['ru', 'kk', 'en'] as const).map(lang => (
                    <button
                      key={lang}
                      onClick={() => changeLang(lang)}
                      className={[
                        'py-2.5 rounded-xl text-sm font-medium transition-colors border-2',
                        studentLang === lang
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500',
                      ].join(' ')}
                    >
                      {LANG_NAMES[lang]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Code input */}
              <div className="space-y-2">
                <label
                  htmlFor="code-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t.lessonCode}
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
              </div>

              {errorMsg && (
                <p className="text-sm text-red-600 text-center">{errorMsg}</p>
              )}

              <button
                onClick={connect}
                disabled={!canConnect}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-400 text-white text-lg font-medium rounded-xl transition-colors"
              >
                {t.connect}
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── Connecting ─────────────────────────────────────────────────────────────
  if (state === 'connecting') {
    return (
      <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logorb.svg" alt="InclusiveTalk" width={36} height={36} className="rounded-lg" />
            <span className="text-lg font-bold text-gray-900 dark:text-white">InclusiveTalk</span>
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex-1 flex items-center justify-center bg-white dark:bg-gray-950">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-500 dark:text-gray-400">{t.connecting}</p>
          </div>
        </main>
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logorb.svg" alt="InclusiveTalk" width={36} height={36} className="rounded-lg" />
            <span className="text-lg font-bold text-gray-900 dark:text-white">InclusiveTalk</span>
          </Link>
          <ThemeToggle />
        </header>
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-sm">
            <p className="text-xl font-semibold text-red-600">{t.error}</p>
            <p className="text-gray-500 dark:text-gray-400">{errorMsg}</p>
            <button
              onClick={retry}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors"
            >
              {t.retry}
            </button>
          </div>
        </main>
      </div>
    )
  }

  // ── Active ─────────────────────────────────────────────────────────────────
  const bottomPadding = (questionOpen || aiPanelOpen) ? 280 : 130

  return (
    <main className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <header className="sticky top-0 flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 z-10">
        <div className="flex items-center gap-2 min-w-0">
          {lessonEnded ? (
            <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">{t.lessonEnded}</span>
          ) : (
            <>
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate">
                {connectedName} · #{connectedCode}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <ThemeToggle />
          <button
            onClick={disconnect}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors px-3 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            {t.disconnect}
          </button>
        </div>
      </header>

      <div
        className="flex-1 overflow-y-auto px-5 py-8 space-y-6"
        style={{ paddingBottom: `${bottomPadding}px` }}
      >
        {subtitles.length === 0 && !lessonEnded && (
          <p className="text-center text-gray-500 text-2xl mt-16">
            {t.waitingTeacher}
          </p>
        )}
        {subtitles.map((line, i) => (
          <p key={i} className="text-3xl md:text-4xl font-medium leading-relaxed text-gray-900 dark:text-white">
            {line}
          </p>
        ))}
        {lessonEnded && (
          <p className="text-center text-gray-500 text-xl pt-6 border-t border-gray-200 dark:border-gray-800">
            — {t.lessonEnded} —
          </p>
        )}
        <div ref={subtitlesEndRef} />
      </div>

      {/* Fixed bottom panel */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-800">

        {aiPanelOpen && (
          <div className="px-3 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
            <div className="max-w-2xl mx-auto">
              {aiLoading ? (
                <div className="flex items-center justify-center py-4 gap-2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t.aiThinking}</span>
                </div>
              ) : aiQuestions.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-3">
                  {t.aiNoQuestions}
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-500 mb-2">{t.aiSelectOrWrite}</p>
                  {aiQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQuestionText(q)
                        setQuestionOpen(true)
                        setAiPanelOpen(false)
                      }}
                      className="w-full text-left text-sm text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {questionOpen && (
          <div className="px-3 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
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
                placeholder={t.questionPlaceholder}
                maxLength={MAX_QUESTION_LEN}
                rows={3}
                className="w-full bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white text-base rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 dark:placeholder-gray-500"
                style={{ minHeight: '80px', maxHeight: '160px' }}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-500">
                  {questionText.length} / {MAX_QUESTION_LEN}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setQuestionOpen(false); setQuestionText('') }}
                    className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={sendQuestion}
                    disabled={!questionText.trim() || questionCooldown || lessonEnded}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 dark:disabled:text-gray-500 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
                  >
                    {t.send}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="max-w-2xl mx-auto px-3 py-2 border-b border-gray-200 dark:border-gray-800">
          {questionSent ? (
            <p className="text-center text-sm text-green-600 dark:text-green-400 font-medium py-0.5">
              ✅ {t.sent}
            </p>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={fetchAIQuestions}
                disabled={lessonEnded || aiCooldown || aiLoading}
                className="flex-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors py-0.5 flex items-center justify-center gap-1.5"
              >
                {aiLoading ? t.aiThinking : t.suggestQuestion}
              </button>
              <div className="w-px h-4 bg-gray-300 dark:bg-gray-700 shrink-0" />
              <button
                onClick={() => { if (!lessonEnded) { setQuestionOpen(v => !v); setAiPanelOpen(false) } }}
                disabled={lessonEnded}
                className="flex-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors py-0.5 flex items-center justify-center gap-1.5"
              >
                {questionOpen ? t.collapse : t.writeQuestion}
              </button>
            </div>
          )}
        </div>

        <div className="px-2 py-2">
          <div className="grid grid-cols-5 gap-1 max-w-2xl mx-auto">
            {SIGNALS.map(({ type, icon, color }) => {
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
                    {sent ? t.signalSent : SIGNAL_LABELS[studentLang][type]}
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
