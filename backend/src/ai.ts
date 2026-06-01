import OpenAI from 'openai'

const apiKey = process.env.OPENAI_API_KEY
const client = apiKey ? new OpenAI({ apiKey }) : null

const LANG_NAMES: Record<string, string> = {
  ru: 'русский',
  kk: 'казахский',
  en: 'английский',
}

export async function generateQuestions(
  transcript: string,
  language: 'ru' | 'kk' | 'en',
): Promise<string[]> {
  if (!client) {
    console.error('[AI] OPENAI_API_KEY not set')
    return []
  }
  const langName = LANG_NAMES[language]
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Ты — ассистент глухого или слабослышащего студента в учебном классе. Преподаватель ведёт урок на разные темы: математика, программирование, физика, география, история, литература, базы данных, информатика и др. Студент может не расслышать или не успеть понять что было только что сказано.

        Тебе передан транскрипт последних 30-60 секунд речи преподавателя. Сгенерируй 4-5 КОРОТКИХ УТОЧНЯЮЩИХ вопросов которые студент мог бы захотеть нажать прямо сейчас.

        ХОРОШИЕ вопросы (примеры по разным предметам):
        - "Повторите определение цикла"
        - "Что такое функция?"
        - "Какая формула площади круга?"
        - "Когда было это событие?"
        - "Кто автор произведения?"
        - "Где находится этот город?"
        - "Что такое первичный ключ?"
        - "Повторите последний пример"
        - "Как пишется этот термин?"

        ПЛОХИЕ вопросы (НЕ генерировать):
        - Философские расширения темы ("Какое значение имеет X для общества?")
        - Сравнения двух понятий ("Чем X отличается от Y?")
        - Вопросы требующие долгого ответа
        - Просьбы решить задачу или дать готовый код/формулу полностью

        ПРАВИЛА:
        1. Каждый вопрос — 3-8 слов, простой и конкретный
        2. Уточняем КОНКРЕТНЫЕ термины или факты которые прозвучали в транскрипте
        3. Используем формулировки "повторите", "что такое", "когда", "где", "кто", "как пишется"
        4. Запрещено выдавать готовые ответы — только формулировки вопросов
        5. Если транскрипт пустой или короткий — дай общие вопросы: "Повторите тему", "Можно медленнее?", "Какая цель урока?"

        Язык вопросов: ${langName}.

        Отвечай строго в JSON: {"questions": ["вопрос1", "вопрос2", "вопрос3", "вопрос4", "вопрос5"]}`,
        },
        {
          role: 'user',
          content: transcript.slice(0, 2000) || '(транскрипт пуст)',
        },
      ],
    })
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? '{}',
    ) as { questions?: unknown }
    if (!Array.isArray(parsed.questions)) return []
    return parsed.questions
      .filter((q): q is string => typeof q === 'string')
      .slice(0, 5)
  } catch (err) {
    console.error(
      `[AI] generateQuestions failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}
