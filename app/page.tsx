import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-white dark:bg-gray-950">
      <div className="w-full max-w-md text-center space-y-10">
        <div className="space-y-4">
          <h1 className="text-6xl font-bold text-gray-900 dark:text-white tracking-tight">
            InclusiveTalk
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed max-w-sm mx-auto">
            Живые субтитры для лекций. Помощь глухим студентам в учебном классе.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/teacher"
            className="flex-1 sm:flex-none px-8 py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-lg font-medium rounded-2xl transition-colors text-center"
          >
            Я преподаватель
          </Link>
          <Link
            href="/student"
            className="flex-1 sm:flex-none px-8 py-4 bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900 text-white text-lg font-medium rounded-2xl transition-colors text-center"
          >
            Я студент
          </Link>
        </div>
      </div>
    </main>
  )
}
