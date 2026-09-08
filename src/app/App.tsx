import { RouterProvider, createBrowserRouter } from 'react-router-dom'

type AppProps = {
  router: ReturnType<typeof createBrowserRouter>
}

export function App({ router }: AppProps) {
  return <RouterProvider router={router} />
}
