import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import { generateQuestions } from './ai.js'

// ── Room state ────────────────────────────────────────────────────────────────

interface Student {
  id: string
  name: string
  socket: WebSocket
  joinedAt: number
}

interface Room {
  teacher: WebSocket | null
  students: Map<string, Student>  // key = studentId
  language: 'ru' | 'kk' | 'en'
}

interface SocketMeta {
  code: string
  role: 'teacher' | 'student'
  name?: string
  studentId?: string
}

const rooms = new Map<string, Room>()
const socketMeta = new Map<WebSocket, SocketMeta>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(socket: WebSocket, msg: object): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg))
  }
}

function broadcastStudents(room: Room, msg: object): void {
  for (const student of room.students.values()) send(student.socket, msg)
}

// ── Server ────────────────────────────────────────────────────────────────────

const app = Fastify({ logger: { level: 'info' } })

await app.register(cors, { origin: true })
await app.register(websocketPlugin)

app.get('/', async () => ({ status: 'ok', rooms: rooms.size }))

app.get('/ws', { websocket: true }, (socket: WebSocket) => {
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>

      // ── register ────────────────────────────────────────────────────────
      if (msg.type === 'register') {
        const role = String(msg.role ?? '')
        const code = String(msg.code ?? '')
        if (!role || !code) return

        if (role === 'teacher') {
          const rawLang = String(msg.language ?? 'ru')
          const language = (['ru', 'kk', 'en'].includes(rawLang) ? rawLang : 'ru') as 'ru' | 'kk' | 'en'
          if (!rooms.has(code)) {
            rooms.set(code, { teacher: null, students: new Map<string, Student>(), language })
          } else {
            rooms.get(code)!.language = language
          }
          const room = rooms.get(code)!
          room.teacher = socket
          socketMeta.set(socket, { code, role: 'teacher' })
          const studentsList = Array.from(room.students.values()).map(s => ({
            studentId: s.id,
            name: s.name,
            joinedAt: s.joinedAt,
          }))
          send(socket, { type: 'registered', students: studentsList })
          app.log.info(`Teacher registered room ${code}`)

        } else if (role === 'student') {
          const room = rooms.get(code)
          if (!room?.teacher) {
            send(socket, { type: 'error', message: 'Комната не найдена' })
            socket.close()
            return
          }
          const name = String(msg.name ?? '').trim()
          if (!name || name.length > 50) {
            send(socket, { type: 'error', message: 'Имя обязательно' })
            socket.close()
            return
          }
          const studentId = randomUUID()
          const joinedAt = Date.now()
          const student: Student = { id: studentId, name, socket, joinedAt }
          room.students.set(studentId, student)
          socketMeta.set(socket, { code, role: 'student', name, studentId })
          send(socket, { type: 'joined', studentId, language: room.language })
          if (room.teacher) {
            send(room.teacher, { type: 'student_joined', studentId, name, joinedAt })
          }
          app.log.info(`Student ${name} (${studentId}) joined room ${code}`)
        }

      // ── transcript (teacher → students) ─────────────────────────────────
      } else if (msg.type === 'transcript') {
        const meta = socketMeta.get(socket)
        if (!meta) return
        const room = rooms.get(meta.code)
        if (!room) return
        broadcastStudents(room, { type: 'transcript', text: msg.text })
        app.log.info(`Broadcast to ${room.students.size} students in room ${meta.code}`)

      // ── signal (student → teacher) ────────────────────────────────────────
      } else if (msg.type === 'signal') {
        const meta = socketMeta.get(socket)
        if (!meta || meta.role !== 'student') return
        const room = rooms.get(meta.code)
        if (!room) return
        const signalType = String(msg.signalType ?? '')
        const valid = ['confused', 'repeat', 'slow', 'question', 'understood']
        if (!valid.includes(signalType)) return
        if (room.teacher) {
          send(room.teacher, {
            type: 'signal',
            signalType,
            studentId: meta.studentId,
            name: meta.name,
            timestamp: Date.now(),
          })
        }
        app.log.info(`Signal '${signalType}' from ${meta.name} in room ${meta.code}`)

      // ── question (student → teacher) ──────────────────────────────────────
      } else if (msg.type === 'question') {
        const meta = socketMeta.get(socket)
        if (!meta || meta.role !== 'student') return
        const room = rooms.get(meta.code)
        if (!room) return
        const text = String(msg.text ?? '').trim()
        if (!text || text.length > 500) return
        if (room.teacher) {
          send(room.teacher, {
            type: 'question',
            text,
            studentId: meta.studentId,
            name: meta.name,
            timestamp: Date.now(),
          })
        }
        app.log.info(`Question from ${meta.name} in room ${meta.code}: ${text.slice(0, 50)}`)

      // ── gesture (student → teacher) ───────────────────────────────────────
      } else if (msg.type === 'gesture') {
        const meta = socketMeta.get(socket)
        if (!meta || meta.role !== 'student') return
        const room = rooms.get(meta.code)
        if (!room) return
        const letter = String(msg.letter ?? '').trim()
        if (!letter) return
        if (room.teacher) {
          send(room.teacher, {
            type: 'gesture',
            letter,
            studentId: meta.studentId,
            name: meta.name,
            timestamp: Date.now(),
          })
        }
        app.log.info(`Gesture '${letter}' from ${meta.name} in room ${meta.code}`)
      }

    } catch {
      // ignore malformed JSON
    }
  })

  socket.on('close', () => {
    const meta = socketMeta.get(socket)
    if (!meta) return
    socketMeta.delete(socket)

    const room = rooms.get(meta.code)
    if (!room) return

    if (meta.role === 'teacher') {
      broadcastStudents(room, { type: 'room_closed' })
      rooms.delete(meta.code)
      app.log.info(`Teacher left room ${meta.code}, room closed`)
    } else {
      if (meta.studentId) room.students.delete(meta.studentId)
      if (room.teacher) {
        send(room.teacher, { type: 'student_left', studentId: meta.studentId, name: meta.name })
      }
      app.log.info(`Student ${meta.name} left room ${meta.code} (remaining: ${room.students.size})`)
    }
  })
})

// ── AI question generation ────────────────────────────────────────────────────

app.post<{ Body: { transcript?: string; language?: string } }>(
  '/api/generate-questions',
  async (request, reply) => {
    const { transcript = '', language = 'ru' } = request.body ?? {}
    const lang = (['ru', 'kk', 'en'].includes(language) ? language : 'ru') as 'ru' | 'kk' | 'en'
    const questions = await generateQuestions(transcript, lang)
    return reply.send({ questions })
  },
)

// ── Start ─────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3001
await app.listen({ port, host: '0.0.0.0' })
