export type SignalType = 'confused' | 'repeat' | 'slow' | 'question' | 'understood'

export interface Signal {
  id: string
  type: SignalType
  timestamp: number
  studentId: string
}
