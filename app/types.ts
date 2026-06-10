export type SignalType = 'confused' | 'repeat' | 'slow' | 'question' | 'understood'

export interface FeedbackItem {
  id: string
  kind: 'signal' | 'question' | 'gesture'
  signalType?: SignalType
  questionText?: string
  gestureLetter?: string
  timestamp: number
  studentId: string
  studentName: string
}

export interface StudentInfo {
  studentId: string
  name: string
  joinedAt: number
}

// ── WebSocket message types ──────────────────────────────────────────────────

export type ServerToClientMessage =
  | { type: 'registered'; students: StudentInfo[]; teacherToken: string }
  | { type: 'joined'; studentId: string; language: 'ru' | 'kk' | 'en' }
  | { type: 'error'; message: string }
  | { type: 'transcript'; text: string }
  | { type: 'room_closed' }
  | { type: 'teacher_disconnected' }
  | { type: 'teacher_reconnected' }
  | { type: 'student_joined'; studentId: string; name: string; joinedAt: number }
  | { type: 'student_left'; studentId: string; name: string }
  | { type: 'signal'; signalType: SignalType; studentId: string; name: string; timestamp: number }
  | { type: 'question'; text: string; studentId: string; name: string; timestamp: number }
  | { type: 'gesture'; letter: string; studentId: string; name: string; timestamp: number }

export type ClientToServerMessage =
  | { type: 'register'; role: 'teacher'; code: string; language: 'ru' | 'kk' | 'en'; token?: string }
  | { type: 'register'; role: 'student'; code: string; name: string }
  | { type: 'transcript'; text: string }
  | { type: 'signal'; code: string; signalType: SignalType }
  | { type: 'question'; code: string; text: string }
  | { type: 'gesture'; code: string; letter: string }
