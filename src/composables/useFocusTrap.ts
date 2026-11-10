import { onBeforeUnmount, onMounted, ref } from 'vue'

const FOCUSABLE = 'button, input, [href], select, textarea'

/**
 * Keeps keyboard focus inside a modal surface and closes it on Escape.
 * Attach `container` to the element that wraps the focusable controls.
 */
export function useFocusTrap(onClose: () => void) {
  const container = ref<HTMLElement | null>(null)

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    if (event.key !== 'Tab' || !container.value) {
      return
    }

    const focusable = [...container.value.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => !element.hasAttribute('disabled'))
    if (focusable.length === 0) {
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    const outside = !container.value.contains(active)

    if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && (active === first || outside)) {
      event.preventDefault()
      last.focus()
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

  return { container }
}
