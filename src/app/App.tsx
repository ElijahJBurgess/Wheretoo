import { RouterProvider } from 'react-router-dom'
import { appRouter } from './router/router'

export function App() {
  return <RouterProvider router={appRouter} />
}
