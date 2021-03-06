/* @flow */

import debounce from './debounce'
import XHRError from './xhr-error'

const requests = new WeakMap()
const previousValues = new WeakMap()

export default class AutoCheckElement extends HTMLElement {
  boundCheck: () => {}
  input: HTMLInputElement

  constructor() {
    super()
    this.boundCheck = debounce(this.check.bind(this), 300)
  }

  connectedCallback() {
    const input = this.querySelector('input')
    if (input instanceof HTMLInputElement) {
      this.input = input
      this.input.addEventListener('change', this.boundCheck)
      this.input.addEventListener('input', this.boundCheck)
    }
  }

  disconnectedCallback() {
    if (this.input) {
      this.input.removeEventListener('change', this.boundCheck)
      this.input.addEventListener('input', this.boundCheck)
    }
  }

  get src(): string {
    const src = this.getAttribute('src')
    if (!src) return ''

    const link = this.ownerDocument.createElement('a')
    link.href = src
    return link.href
  }

  set src(value: string) {
    this.setAttribute('src', value)
  }

  get csrf(): string {
    return this.getAttribute('csrf') || ''
  }

  set csrf(value: string) {
    this.setAttribute('csrf', value)
  }

  check() {
    if (!this.src) {
      throw new Error('missing src')
    }
    if (!this.csrf) {
      throw new Error('missing csrf')
    }

    const body = new FormData()
    body.append('authenticity_token', this.csrf) // eslint-disable-line github/authenticity-token
    body.append('value', this.input.value)

    this.input.dispatchEvent(new CustomEvent('autocheck:send', {detail: {body}, bubbles: true, cancelable: true}))

    const id = body.entries ? [...body.entries()].sort().toString() : null
    if (id && id === previousValues.get(this.input)) return
    previousValues.set(this.input, id)

    if (!this.input.value.trim()) {
      this.input.dispatchEvent(new CustomEvent('autocheck:complete', {bubbles: true, cancelable: true}))
      return
    }

    const always = () => {
      this.dispatchEvent(new CustomEvent('loadend'))
      this.input.dispatchEvent(new CustomEvent('autocheck:complete', {bubbles: true, cancelable: true}))
    }

    this.dispatchEvent(new CustomEvent('loadstart'))
    performCheck(this.input, body, this.src)
      .then(data => {
        this.dispatchEvent(new CustomEvent('load'))

        const warning = data ? data.trim() : null
        this.input.dispatchEvent(
          new CustomEvent('autocheck:success', {
            detail: {warning},
            bubbles: true,
            cancelable: true
          })
        )
      })
      .catch(error => {
        this.dispatchEvent(new CustomEvent('error'))
        this.input.dispatchEvent(
          new CustomEvent('autocheck:error', {
            detail: {message: errorMessage(error)},
            bubbles: true,
            cancelable: true
          })
        )
      })
      .then(always, always)
  }
}

function errorMessage(error: XHRError) {
  if (error.statusCode === 422 && error.responseText) {
    if (error.contentType.includes('text/html; fragment')) {
      return error.responseText
    }
  }
}

function performCheck(input, body, url) {
  const pending = requests.get(input)
  if (pending) pending.abort()

  const clear = () => requests.delete(input)

  const xhr = new XMLHttpRequest()
  requests.set(input, xhr)

  xhr.open('POST', url, true)
  xhr.setRequestHeader('Accept', 'text/html; fragment')
  const result = send(xhr, body)
  result.then(clear, clear)
  return result
}

function send(xhr, body) {
  return new Promise((resolve, reject) => {
    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText)
      } else {
        reject(new XHRError(xhr.status, xhr.responseText, xhr.getResponseHeader('Content-Type')))
      }
    }
    xhr.onerror = function() {
      reject(new XHRError(xhr.status, xhr.responseText, xhr.getResponseHeader('Content-Type')))
    }
    xhr.send(body)
  })
}

if (!window.customElements.get('auto-check')) {
  window.AutoCheckElement = AutoCheckElement
  window.customElements.define('auto-check', AutoCheckElement)
}
