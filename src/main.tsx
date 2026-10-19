import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { ThemeProvider } from "@/providers/theme"
import App from './App.tsx'
import { startNativeShell } from "@/lib/native-shell"

void startNativeShell()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <TRPCProvider>
          <App />
        </TRPCProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
