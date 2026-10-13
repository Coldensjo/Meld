import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// No browser context menu (Back, Reload, Inspect...), except the copy/paste one in text fields.
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
