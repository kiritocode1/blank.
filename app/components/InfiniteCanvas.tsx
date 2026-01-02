'use client'

import { useEffect, useRef } from 'react'
import Script from 'next/script'

const EOL = '\n'
const SPACE = ' '
const FONT_HEIGHT = 12
const FONT_WIDTH = 6
const STORE_TEXT = 'blank-editor'
const STORE_CURSOR = 'blank-editor-cursor'

const DEFAULT_VALUE = `
   blank.
`

const DEFAULT_CONFIG = () => ({
    schema: null as string | null,
    font: 'Geist Mono',
    size: '14',
})

let configs = DEFAULT_CONFIG()

function fill(text: string): string {
    const lines = 90
    const columns = 300
    const textLines = text.split(EOL)

    const result: string[] = []
    for (let l = 0; l < Math.max(lines, textLines.length); l++) {
        const tLine = (textLines[l] || '').trimEnd()
        let line = ''
        for (let c = 0; c < Math.max(columns, tLine.length); c++) {
            line += tLine[c] || SPACE
        }
        result.push(line)
    }

    return result.join(EOL)
}

function getLastMatch(value: string, re: RegExp): string | null {
    const result = Array.from(value.matchAll(re))
    if (!result?.length) return null
    return result[result.length - 1][1]
}

export default function InfiniteCanvas() {
    const editorRef = useRef<HTMLDivElement>(null)
    const cmRef = useRef<any>(null)
    const initializedRef = useRef(false)

    const initEditor = () => {
        if (initializedRef.current || !editorRef.current) return

        const CodeMirror = (window as any).CodeMirror
        if (!CodeMirror) return

        initializedRef.current = true
        const HTML = document.documentElement

        const load = () => localStorage.getItem(STORE_TEXT) || DEFAULT_VALUE
        const save = (value: string) =>
            localStorage.setItem(
                STORE_TEXT,
                value
                    .trimEnd()
                    .split(EOL)
                    .map((i) => i.trimEnd())
                    .join(EOL)
            )

        const START_CURSOR = JSON.parse(
            localStorage.getItem(STORE_CURSOR) || '{ "line": 3, "ch": 8 }'
        )

        function isSamePos(a: any, b: any): boolean {
            return a.line === b.line && a.ch === b.ch
        }

        function sortedSelection({ anchor, head }: any): any {
            if (anchor.line === head.line) {
                if (anchor.ch < head.ch) return { anchor: head, head: anchor }
            } else {
                if (anchor.line < head.line) return { anchor: head, head: anchor }
            }
            return { anchor, head }
        }

        function squareRanges({ head, anchor }: any): any[] {
            const l_start = Math.min(head.line, anchor.line)
            const l_end = Math.max(head.line, anchor.line)
            const c_start = Math.min(head.ch, anchor.ch)
            const c_end = Math.max(head.ch, anchor.ch)
            const result = []
            for (let line = l_start; line <= l_end; line++) {
                result.push({
                    head: { line: line, ch: c_start },
                    anchor: { line: line, ch: c_end },
                })
            }
            return result
        }

        function throttle(func: () => void, delay = 1000) {
            let timer: any
            return () => {
                clearTimeout(timer)
                timer = setTimeout(() => {
                    func()
                }, delay)
            }
        }

        function set(cm: any, v: string) {
            const selections = cm.listSelections()
            cm.setValue(v)
            cm.setSelections(selections)
        }

        function getSystemSchema(): string {
            return window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
        }

        function readConfigs(value?: string) {
            const text = value ?? cm.getValue()
            configs = DEFAULT_CONFIG()

            // r.schema dark|light|auto controls theme
            configs.schema = getLastMatch(text, / r\.schema (dark|light|auto) /g) || 'auto'
            configs.font = `'${getLastMatch(text, / r\.font (.+?)  /g) || configs.font}'`
            configs.size = `${Math.max(
                12,
                +(getLastMatch(text, / r\.size ([\d.]+?) /g) || configs.size)
            )}px`

            updateConfigs()
        }

        function updateConfigs() {
            HTML.style.cssText = `
                --config-font: ${configs.font};
                --config-size: ${configs.size};
            `
            HTML.className =
                configs.schema === 'dark'
                    ? 'dark'
                    : configs.schema === 'light'
                        ? 'light'
                        : getSystemSchema()
            cm.refresh()
        }

        function onEnterPressed(cm: any) {
            const { line, ch } = cm.getCursor()
            const text = cm.getRange({ line, ch: 0 }, { line, ch })
            let space = 0
            let targetCh = ch
            for (let i = ch; i >= 0; i--) {
                if (text[i] === SPACE) {
                    space++
                    if (space === 2) {
                        targetCh = i + 2
                        break
                    }
                } else {
                    space = 0
                }
            }
            cm.setCursor({ line: line + 1, ch: targetCh })
        }

        function onBackspacePressed(type: 'backspace' | 'delete') {
            return (cm: any) => {
                const selections = cm.listSelections()
                for (const selection of selections.reverse()) {
                    const { anchor, head } = sortedSelection(selection)
                    if (isSamePos(anchor, head)) {
                        const { line, ch } = anchor
                        cm.replaceRange(
                            SPACE,
                            { line, ch: ch + (type === 'delete' ? 1 : -1) },
                            anchor
                        )
                        cm.setCursor({ line, ch: ch + (type === 'delete' ? 0 : -1) })
                    } else {
                        let space = ''
                        if (anchor.line === head.line)
                            space = new Array(anchor.ch - head.ch).fill(SPACE).join('')
                        else
                            space =
                                new Array(anchor.line - head.line + 1).fill('').join(EOL) +
                                new Array(anchor.ch).fill(SPACE).join('')

                        cm.replaceRange(space, head, anchor)
                        cm.setCursor(head)
                    }
                }
                updateFillNow()
            }
        }

        function onCut(cm: any) {
            navigator.clipboard.writeText(cm.getSelections().join('\n'))
            onBackspacePressed('backspace')(cm)
        }

        function onShiftSpace(cm: any) {
            cm.replaceRange(SPACE, cm.getCursor(), cm.getCursor())
        }

        const OPTIONS_COMMON = {
            lineWrapping: false,
            tabSize: 2,
            lineSeparator: EOL,
            indentWithTabs: false,
            scrollbarStyle: null,
            dragDrop: false,
            extraKeys: CodeMirror.normalizeKeyMap({
                Tab: (cm: any) => cm.execCommand('indentMore'),
                'Shift-Tab': (cm: any) => cm.execCommand('indentLess'),
                'Shift-Space': onShiftSpace,
                Enter: onEnterPressed,
                Backspace: onBackspacePressed('backspace'),
                Delete: onBackspacePressed('delete'),
                'Ctrl-D': onBackspacePressed('backspace'),
                'Cmd-D': onBackspacePressed('backspace'),
                'Ctrl-X': onCut,
                'Cmd-X': onCut,
            }),
        }

        const cm = CodeMirror(editorRef.current, {
            ...OPTIONS_COMMON,
            value: fill(load()),
        })

        cmRef.current = cm

        const updateFillNow = () => {
            set(cm, fill(cm.getValue()))
            readConfigs()
        }
        const updateFill = throttle(updateFillNow)

        cm.setSize('100%', '100%')
        cm.toggleOverwrite(true)

        cm.on('beforeChange', (_: any, event: any) => {
            const { origin, text, cancel } = event
            if (origin === 'setValue') {
                return
            } else if (origin === 'paste') {
                cancel()
                const { line, ch } = cm.getCursor()
                text.forEach((t: string, i: number) => {
                    cm.replaceRange(
                        t,
                        { line: line + i, ch },
                        { line: line + i, ch: ch + t.length }
                    )
                })
                cm.setCursor({ line, ch })
            } else if (origin === '+input') {
                const selections = cm.listSelections()
                if (
                    selections.length === 1 &&
                    isSamePos(selections[0].head, selections[0].anchor)
                ) {
                    return
                } else {
                    cancel()
                    for (const { head, anchor } of selections)
                        cm.replaceRange(
                            text[0].repeat(Math.abs(head.ch - anchor.ch)),
                            head,
                            anchor
                        )
                }
            }
        })

        cm.on('change', (_: any, { origin }: any) => {
            if (origin === 'setValue') {
                return
            }
            save(cm.getValue())
            updateFill()
        })

        cm.on('cursorActivity', () => {
            localStorage.setItem(STORE_CURSOR, JSON.stringify(cm.getCursor()))
        })

        cm.on('beforeSelectionChange', (_: any, e: any) => {
            const { ranges } = e
            if (ranges.length) {
                const head = sortedSelection(ranges[0]).head
                const anchor = sortedSelection(ranges[ranges.length - 1]).anchor
                e.update(squareRanges({ head, anchor }))
            }
        })

        cm.setCursor(START_CURSOR)
        cm.focus()
        readConfigs()
    }

    useEffect(() => {
        // Try to init if CodeMirror is already loaded
        if ((window as any).CodeMirror) {
            initEditor()
        }
    }, [])

    return (
        <>
            <link rel="stylesheet" href="/codemirror.min.css" />
            <Script
                src="/codemirror.min.js"
                strategy="afterInteractive"
                onLoad={initEditor}
            />
            <div ref={editorRef} id="editor" className="w-full h-full" />
        </>
    )
}
