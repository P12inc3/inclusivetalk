export type SignalType = 'confused' | 'repeat' | 'slow' | 'question' | 'understood'

export interface FeedbackItem {
  id: string
  kind: 'signal' | 'question'
  signalType?: SignalType
  questionText?: string
  timestamp: number
  studentId: string
}
