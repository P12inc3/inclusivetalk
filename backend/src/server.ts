import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocketPlugin from '@fastify/websocket'
import { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

// ── Room state ────────────────────────────────────────────────────────────────

interface Room {
  teacher: WebSocket | null
  students: Set<WebSocket>
}

interface SocketMeta {
  code: string
  role: 'teacher' | 'student'
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
  for (const s of room.students) send(s, msg)
}

// ── Server ────────────────────────────────────────────────────────────────────

const app = Fastify({ logger: { level: 'info' } })

await app.register(cors, { origin: true })
await app.register(websocketPlugin)

// Status endpoint
app.get('/', async () => ({ status: 'ok', rooms: rooms.size }))

// WebSocket endpoint
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
          if (!rooms.has(code)) {
            rooms.set(code, { teacher: null, students: new Set<WebSocket>() })
          }
          const room = rooms.get(code)!
          room.teacher = socket
          socketMeta.set(socket, { code, role: 'teacher' })
          send(socket, { type: 'registered' })
          app.log.info(`Teacher registered room ${code}`)

        } else if (role === 'student') {
          const room = rooms.get(code)
          if (!room?.teacher) {
            send(socket, { type: 'error', message: 'Комната не найдена' })
            socket.close()
            return
          }
          const studentId = randomUUID()
          room.students.add(socket)
          socketMeta.set(socket, { code, role: 'student', studentId })
          send(socket, { type: 'joined' })
          app.log.info(`Student joined room ${code} (total: ${room.students.size})`)
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
            timestamp: Date.now(),
          })
        }
        app.log.info(`Signal '${signalType}' from student in room ${meta.code}`)
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
      room.students.delete(socket)
      app.log.info(`Student left room ${meta.code} (remaining: ${room.students.size})`)
    }
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 3001
await app.listen({ port, host: '0.0.0.0' })
