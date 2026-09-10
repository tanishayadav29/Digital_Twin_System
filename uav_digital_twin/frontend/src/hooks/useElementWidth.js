import { useEffect, useRef, useState } from 'react'

// Charts draw in real pixels (crisp 1px lines, unscaled text), so they need
// to know how wide their container is.
export function useElementWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
