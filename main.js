{
    let editor
    let printedVMCodeView


    // poll blazor until it's initialized
    const interval = setInterval(() => {
        try {
            invoke('Init', 'int main(){return 2+2;}')
            clearInterval(interval)
            main()
        } catch (error) {
            // blazor not initialized yet
        }
    }, 100)

    function main() {

        const isNoScript = script.noScript === true

        const wired = app({

            locked: isNoScript ? {} : {
                cCode: true,
                compileBtn: true,
                stepBtn: true,
                runBtn: true,
            },

            highlighted: {},

            isWriting: false,

            isBlinking: !isNoScript,

            scriptIndex: -1,

            chatExpanded: false,
            chatParagraphs: [],

            decoratedAddresses: {},
            ctx: null,

            stackFrames: [],
            objects: [],

            codeFrom: 0,
            stackFrom: 0,
            heapFrom: 0,

            MEMORY_VIEW_SIZE: 25,
            printedVMCode: '',
            isCompilerError: true,
            cCode: isNoScript ? `int main() {
    return sum(5);
}

int sum(int n) {
    if(!n) return 0;
    return 1 + sum(n - 1);
}` : ''
        }, {
                setState: newState => _ => Object.assign({}, newState),
                getState: _ => state => state
            }, view, document.getElementById('ha-root'))

        function getState() {
            return wired.getState()
        }
        function lazyHandler(handler) {
            return function (ev) {
                const state = getState()
                handler(state, ev)
                wired.setState(state)
            }
        }

        function view() {
            return h(
                'div', {
                    class: 'ha-container',
                    onclick: lazyHandler((state, e) => {
                        state.chatExpanded = false
                    })
                },
                CCodeSection(),
                InstructionsSection(),
                MemorySection(getState().codeFrom, lazyHandler((state, arg) => state.codeFrom = Math.max(0, state.codeFrom + arg)), 3),
                MemorySection(getState().stackFrom, lazyHandler((state, arg) => state.stackFrom = Math.max(0, state.stackFrom + arg)), 4),
                MemorySection(getState().heapFrom, lazyHandler((state, arg) => state.heapFrom = Math.max(0, state.heapFrom + arg)), 5),
                StackFramesTexts(),
                InstructionsTexts(),
                Chat()
            )
        }

        function CCodeSection() {

            if (editor) {
                const val = getState().cCode
                const actualVal = editor.getValue()
                if (val !== actualVal) {
                    editor.setValue(val)
                    editor.selection.clearSelection()
                }
                editor.setReadOnly(getState().locked.cCode)
            }


            return h(
                'div',
                { class: 'generic-container shadow ' },
                h('pre', {
                    class: classIf(getState().locked.cCode, 'locked'),
                    onmouseover: lazyHandler(state => handleEvent(state, 'code-hovered')),
                    id: 'editor',
                    oncreate: lazyHandler(_ => {
                        editor = ace.edit("editor")
                        editor.session.setUseWrapMode(true)
                        editor.setHighlightActiveLine(false)
                        editor.setFontSize(15)
                        editor.renderer.setShowGutter(false)
                        editor.setTheme("ace/theme/sqlserver")
                        editor.session.setMode("ace/mode/c_cpp")

                        editor.session.on('change', () => {
                            lazyHandler(state => {
                                const text = editor.session.getValue()
                                localStorage.setItem('c-code', text)
                                state.cCode = text
                            })()
                        })

                    })
                }),
                CompileBtn()
            )
        }



        function CompileBtn() {
            return h(
                'div', {
                    class: 'generic-top-right-btn ' + classIf(getState().locked.compileBtn, 'locked'),
                    onclick: lazyHandler((state, e) => {
                        e.stopPropagation()
                        if (state.locked.compileBtn) return
                        try {
                            invoke('Init', getState().cCode)
                            state.isCompilerError = false
                            getNewPrintedCode(state)
                            state.codeFrom = invoke('IP')
                            state.heapFrom = invoke('HP')
                            state.stackFrom = invoke('SP')
                            state.stackFrames = [{
                                begin: state.stackFrom - 1,
                                firstInstruction: state.codeFrom,
                                bp: state.stackFrom + 1
                            }]
                            state.objects = []
                            state.ctx = invoke('CTX')
                            state.decoratedAddresses = decorateStackAddresses()
                            handleEvent(state, 'compile-clicked')
                        } catch (error) {
                            const end = error.message.indexOf('at Microsoft.JSInterop')
                            state.isCompilerError = true
                            state.printedVMCode = error.message.substring(18, end)
                        }
                    }),
                    onmouseover: lazyHandler(state => handleEvent(state, 'compile-hovered'))
                },
                'Compile'
            )
        }

        function InstructionsSection() {

            if (printedVMCodeView) {
                const val = getState().printedVMCode
                printedVMCodeView.setValue(val)
            }


            return h(
                'div',
                { class: 'generic-container shadow' + classIf(getState().highlighted[2], 'box-shadow-highlighted') },
                h('pre', {
                    id: 'printed-view',
                    oncreate: lazyHandler(_ => {
                        printedVMCodeView = ace.edit("printed-view")
                        printedVMCodeView.session.setUseWrapMode(true)
                        printedVMCodeView.setFontSize(15)
                        printedVMCodeView.renderer.setShowGutter(false)
                        printedVMCodeView.setTheme("ace/theme/sqlserver")
                        printedVMCodeView.session.setMode("ace/mode/c_cpp")
                        printedVMCodeView.setReadOnly(true)
                        printedVMCodeView.renderer.$cursorLayer.element.style.display = "none"
                        printedVMCodeView.selection.clearSelection()

                        let isSelecting = false

                        printedVMCodeView.selection.on('changeSelection', function (e) {

                            if (isSelecting) return
                            isSelecting = true

                            const toSelect = findLineOfNextInstruction()
                            printedVMCodeView.selection.clearSelection()
                            if (toSelect !== -1) {
                                printedVMCodeView.selection.moveCursorTo(toSelect, 0)
                                printedVMCodeView.selection.selectLine()
                            }

                            isSelecting = false

                        })
                    })
                }),
                !getState().isCompilerError && StepBtn() || null,
                !getState().isCompilerError && RunBtn() || null
            )
        }

        function StepBtn() {
            return h(
                'div', {
                    class: 'generic-top-right-btn' + classIf(getState().locked.stepBtn, 'locked'),
                    onclick: lazyHandler((state, e) => {
                        handleEvent(state, 'step-clicked')
                        e.stopPropagation()
                        if (state.locked.stepBtn) return
                        updateStackFramesAndHeapObjects(state) // always before step
                        if (!invoke('Step')) {
                            const ret = invoke('MemorySlice', invoke('SP'), 1)[0]
                            alert("returned value: " + ret)
                            state.isCompilerError = true // reset
                            state.printedVMCode = ''
                            return
                        }
                        state.decoratedAddresses = decorateStackAddresses()
                        getNewPrintedCode(state)


                        // auto scroll the second sectino
                        const firstRenederedLine = printedVMCodeView.renderer.layerConfig.firstRow
                        const lastRenederedLine = printedVMCodeView.renderer.layerConfig.lastRow
                        const nextInstructionLine = findLineOfNextInstruction()
                        if (nextInstructionLine < firstRenederedLine || nextInstructionLine + 2 > lastRenederedLine) {
                            printedVMCodeView.scrollToLine(nextInstructionLine, false)
                        }

                        // auto scroll sp section

                        const sp = invoke('SP')
                        if (state.stackFrom > sp) {
                            state.stackFrom = sp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        if (sp > state.stackFrom + state.MEMORY_VIEW_SIZE - 1) {
                            state.stackFrom = sp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        state.stackFrom = Math.max(0, state.stackFrom) // todo also upper bound


                        // auto scroll ip section
                        const ip = invoke('IP')
                        if (state.codeFrom > ip) {
                            state.codeFrom = ip - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        if (ip > state.codeFrom + state.MEMORY_VIEW_SIZE - 1) {
                            state.codeFrom = ip - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        state.codeFrom = Math.max(0, state.codeFrom) // todo also upper bound

                        // auto scroll heap section
                        const hp = invoke('HP')
                        if (state.heapFrom > hp) {
                            state.heapFrom = hp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        if (hp > state.heapFrom + state.MEMORY_VIEW_SIZE - 1) {
                            state.heapFrom = hp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        state.heapFrom = Math.max(0, state.heapFrom) // todo also upper bound

                        renderOverlaysLater()
                    })
                },
                'Step'
            )
        }

        function RunBtn() {
            return h(
                'div', {
                    class: 'generic-top-right-btn generic-top-right-btn--second' + classIf(getState().locked.runBtn, 'locked'),
                    onclick: lazyHandler((state, e) => {
                        e.stopPropagation()
                        if (state.locked.runBtn) return
                        while (invoke('Step')) {

                        }
                        const ret = invoke('MemorySlice', invoke('SP'), 1)[0]
                        alert("main() returned " + ret)
                        state.isCompilerError = true // reset
                        state.printedVMCode = ''
                    })
                },
                'Run'
            )
        }

        function MemorySection(sliceBegin, scroll, colNumber) {

            const registers = {
                [invoke('BP')]: 'BP',
                [invoke('SP')]: 'SP',
                [invoke('IP')]: 'IP',
                [invoke('HP')]: 'HP'
            }

            const viewSize = getState().MEMORY_VIEW_SIZE

            let memorySlice
            if (!getState().isCompilerError) {
                memorySlice = invoke('MemorySlice', sliceBegin, viewSize)
            } else {
                memorySlice = [...Array(viewSize)].map(_ => null)
            }

            const template = 'repeat(' + viewSize + ', 1fr)'
            return h(
                'div', {
                    onwheel: e => {
                        scroll(Math.sign(e.deltaY))
                        renderOverlaysLater()
                    },
                    class: 'generic-container memory' + classIf(getState().highlighted[colNumber], 'box-shadow-highlighted'),
                    style: {
                        'grid-template-rows': template
                    }
                },
                memorySlice.map((val, i) => AddressAndValue(sliceBegin + i, val, registers))
            )

        }

        function AddressAndValue(adr, value, registers) {

            const state = getState()

            let color = 'color-grey'
            if (!isCompilerError()) {
                if (registers[adr] == 'SP') {
                    if (invoke('BP') === adr)
                        color = 'color-sp-bp'
                    else
                        color = 'color-sp'
                } else if (registers[adr] == 'BP') {
                    color = 'color-bp'
                } else if (registers[adr] == 'IP') {
                    color = 'color-ip'
                } else if (registers[adr] == 'HP') {
                    color = 'color-hp'
                }
            }

            const decoratedAddress = state.decoratedAddresses[adr]
            const addressOfdecoratedAddress = state.decoratedAddresses[value]
            const opCodeToStr = opCodeToString(value)

            const inParanthesis = isCompilerError() ? null
                : opCodeToStr ? opCodeToStr
                    : decoratedAddress ? decoratedAddress
                        : addressOfdecoratedAddress ? ('&' + addressOfdecoratedAddress)
                            : null

            return h(
                'div', {
                    class: 'address-and-value ' + classIf(getState().highlighted['adr' + adr], 'box-shadow-highlighted'),
                    key: adr
                },
                h(
                    'div', {
                        'data-address': adr,
                        class: 'block block-address vertical-align ' + color
                    },
                    isCompilerError() ? null : adr
                ), h(
                    'div', {
                        class: 'block block-value vertical-align color-grey'
                    },
                    Paranthesize(inParanthesis),
                    h('pre', {}, ' '),
                    value
                )
            )
        }

        function Paranthesize(value) {

            if (!value) return null

            return h(
                'span', {
                    class: 'address-paranthesis'
                },
                '(' + value + ')'
            )

        }

        function StackFramesTexts() {

            if (isCompilerError()) {
                return null
            }

            const texts = []

            const frames = getState().stackFrames
            for (let i = 0; i < frames.length; i++) {

                const { begin, firstInstruction } = frames[i]

                let beginEl = getBlockWithAddress(begin)
                const end = i !== frames.length - 1 ? (frames[i + 1].begin - 1) : invoke('SP')
                let endEl = getBlockWithAddress(end)

                if (!beginEl || !endEl) {

                    if (endEl) {
                        beginEl = getBlockWithAddress(getState().stackFrom)
                    } else if (beginEl) {
                        endEl = getBlockWithAddress(getState().stackFrom + getState().MEMORY_VIEW_SIZE - 1)
                    }
                    else continue
                }

                if (!beginEl || !endEl) continue // sometimes getBlockWithAddress above returns null because document.queryselector read old data

                // draw text using begin and endEL
                texts.push(makeLineBetween(endEl, beginEl, 2.5, getFuncName(firstInstruction), 'sf-' + i))
            }

            return texts
        }

        function InstructionsTexts() {

            if (isCompilerError()) {
                return null
            }

            const state = getState()

            const texts = []

            const functions = state.ctx.backPatch.functionStartAddress.slice().sort((p1, p2) => p1.value < p2.value ? -1 : 1)

            for (let i = 0; i < functions.length; i++) {

                const { key: funcName, value: funcAdr } = functions[i]

                let beginEl = getBlockWithAddress(funcAdr)
                const funcEnd = i !== functions.length - 1 ? (functions[i + 1].value - 1) : state.ctx.segments.nextCodeAddress - 1
                let endEl = getBlockWithAddress(funcEnd)

                if (!beginEl || !endEl) {

                    if (endEl) {
                        beginEl = getBlockWithAddress(state.codeFrom)
                    } else if (beginEl) {
                        endEl = getBlockWithAddress(state.codeFrom + state.MEMORY_VIEW_SIZE - 1)
                    } else if (funcAdr < state.codeFrom && funcEnd > state.codeFrom + state.MEMORY_VIEW_SIZE - 1) {
                        // we are viewing the function but we don't see neiher the end nor the beginning
                        beginEl = getBlockWithAddress(state.codeFrom)
                        endEl = getBlockWithAddress(state.codeFrom + state.MEMORY_VIEW_SIZE - 1)
                    }
                    else continue
                }

                if (!beginEl || !endEl) continue // sometimes getBlockWithAddress above returns null because document.queryselector read old data

                // draw text using begin and endEL
                texts.push(makeLineBetween(endEl, beginEl, 2.5, funcName, 'it-' + funcName))
            }

            return texts
        }


        function Chat() {

            if (isNoScript) return null

            const state = getState()

            return h(
                'div', {
                    class: 'chat-btn shadow ' + classIf(state.chatExpanded, 'chat-btn-expanded') + classIf(state.isBlinking, 'blinking'),
                    onclick: lazyHandler((state, e) => {
                        e.stopPropagation()
                        if (state.chatExpanded) {
                            handleEvent(state, 'chat-clicked')
                        }
                        else {
                            state.isBlinking = false
                            handleEvent(state, 'bubble-clicked')
                        }

                        state.chatExpanded = true
                    })
                },
                h(
                    'div', {
                        class: 'chat-inner',
                    },
                    h(
                        'div',
                        { class: 'chat-scrollable' },
                        state.chatParagraphs.map(p => h(
                            'div',
                            { class: 'chat-paragraph' + classIf(p.startsWith('('), 'fade-grey-color') },
                            p
                        ))
                    )
                )
            )
        }


        //utils...
        function getNewPrintedCode(state) {
            const printed = invoke('PrintInstructions')
            state.printedVMCode = printed.split('\n').slice(1).join('\n')
        }

        function findLineOfNextInstruction() {

            const ip = invoke('IP')
            const slice = invoke('MemorySlice', ip, 2)
            const op2Str = opCodeToString(slice[0])

            const printedView = getState().printedVMCode
            const index = printedView.indexOf(invoke('IP') + ' ' + op2Str)

            if (index == -1) {
                return -1
            }

            let i = 0
            let line = 0
            // search for ->
            while (i < index) {
                i++
                if (printedView[i] == '\n') {
                    line++
                }
            }

            return line
        }

        function isCompilerError() {
            return getState().isCompilerError
        }



        const opCodeToStringCache = {}
        function opCodeToString(value) {
            if (opCodeToStringCache[value] !== undefined) {
                return opCodeToStringCache[value]
            }
            return opCodeToStringCache[value] = invoke('OpCodeToString', Number(value))
        }

        function updateStackFramesAndHeapObjects(state) {
            const sp = invoke('SP')
            const hp = invoke('HP')
            const ip = invoke('IP')
            const slice = invoke('MemorySlice', ip, 2)
            const op2Str = opCodeToString(slice[0])
            const arg = slice[1]

            if (op2Str == 'CALL') {
                state.stackFrames.push({
                    begin: sp - arg,
                    firstInstruction: invoke('MemorySlice', sp - arg, 1)[0],
                    bp: sp + 2
                })
            }
            if (op2Str == 'RET') {
                state.stackFrames.pop()
            }

            if (op2Str == 'ALLOC') {
                state.objects.push({
                    begin: hp,
                    size: invoke('MemorySlice', sp, 1)[0]
                })
            }
        }

        function getBlockWithAddress(adr) {
            return document.querySelector('[data-address="' + adr + '"]')
        }

        function makeLineBetween(div1, div2, thickness, fName, key) {
            var off1 = getOffset(div1)
            var off2 = getOffset(div2)
            // bottom leftish
            var x1 = off1.left + off1.width / 50
            var y1 = off1.top + off1.height * 4 / 5
            // top left
            var x2 = off2.left + off2.width / 50
            var y2 = off2.top + off2.height * 1 / 5
            // distance
            var length = Math.sqrt(((x2 - x1) * (x2 - x1)) + ((y2 - y1) * (y2 - y1)))
            // center
            var cx = ((x1 + x2) / 2) - (length / 2)
            var cy = ((y1 + y2) / 2) - (thickness / 2)
            // angle
            var angle = Math.atan2((y1 - y2), (x1 - x2)) * (180 / Math.PI)
            // make hr

            return h(
                'div', {
                    key,
                    class: 'stack-frame-line color-kw',
                    style: {
                        left: cx + 'px',
                        top: cy + 'px',
                        width: length + 'px',
                        height: thickness + 'px',
                        transform: 'rotate(' + angle + 'deg) translateY(5px)'
                    }
                },
                h(
                    'div',
                    { class: 'stack-frame-line-text' },
                    fName
                )
            )
        }

        function getOffset(el) {
            const rect = el.getBoundingClientRect()
            return {
                left: rect.left + window.pageXOffset,
                top: rect.top + window.pageYOffset,
                width: rect.width || el.offsetWidth,
                height: rect.height || el.offsetHeight
            }
        }

        function decorateStackAddresses() {

            const ret = {}
            const state = getState()
            const ctx = state.ctx
            if (!ctx) return

            for (const { firstInstruction, bp } of state.stackFrames) {

                const funcName = ctx.backPatch.functionStartAddress.find(pair => pair.value === firstInstruction).key
                const funcDecl = ctx.semantics.globalIdentifiers.find(pair => pair.key === funcName)

                ret[bp] = 'OLD BP'
                ret[bp - 1] = 'RET IP'

                let offset = 2
                for (const param of funcDecl.value.parameterList.parameters.slice().reverse()) {
                    ret[bp - offset] = 'ARG ' + param.name
                    offset++
                }

                ret[bp - offset] = '&FN ' + funcName

                offset = 1
                const localVars = ctx.semantics.localVars.find(pair => pair.key.name === funcName).value
                for (const local of localVars) {
                    ret[bp + offset++] = 'VAR ' + local
                }
            }

            for (const obj of state.objects) {
                for (let i = 0; i < obj.size; i++) {
                    ret[obj.begin + i] = 'OB[' + obj.size + ',' + i + ']'
                }
            }

            return ret
        }

        function getFuncName(firstInstruction) {
            return getState().ctx.backPatch.functionStartAddress.find(pair => pair.value === firstInstruction).key
        }

        function renderOverlaysLater() {
            setTimeout(lazyHandler(() => { }), 30) // rerender to make sure the stack frame texts read the latest DOM data before rendering
        }

        function classIf(cond, clas) {
            return ' ' + (cond ? clas : '')
        }

        function handleEvent(state, event) {

            if (state.isWriting)
                return

            const nextScriptItem = script[state.scriptIndex + 1]

            if (!nextScriptItem || event !== nextScriptItem.type)
                return

            state.scriptIndex++

            if (nextScriptItem.txt) {
                writeScriptItem(state)
            } else if (nextScriptItem.locked !== undefined) {
                state.locked = nextScriptItem.locked
                handleEvent(state, script[state.scriptIndex + 1].type)
            } else if (nextScriptItem.highlighted) {
                state.highlighted = nextScriptItem.highlighted
                handleEvent(state, script[state.scriptIndex + 1].type)
            } else if (nextScriptItem.code !== undefined) {
                state.cCode = nextScriptItem.code
                handleEvent(state, script[state.scriptIndex + 1].type)
            } else if (nextScriptItem.go2nextSection) {
                location.replace(location.origin + '?' + (Number(window.location.search.substr(1)) + 1))
            }
        }

        function writeScriptItem(state) {

            state.chatExpanded = true

            const txt = script[state.scriptIndex].txt

            state.chatParagraphs.push('')
            state.isWriting = true
            txt.split('').forEach((letter, i) => setTimeout(lazyHandler(state => {
                state.chatParagraphs[state.chatParagraphs.length - 1] += letter
                scrollToBottom(document.getElementsByClassName('chat-scrollable')[0])
                if (i == txt.length - 1) {
                    state.isWriting = false
                    handleEvent(state, 'bot-finished')
                }

            }), 10 + i * 5))
        }
    }

    function invoke() {
        return DotNet.invokeMethod(...['Blazor2', ...arguments])
    }

    function scrollToBottom(objDiv) {
        objDiv.querySelector(':last-child').scrollIntoView()
    }

    function addClickToContinues(items) {
        const newItems = []
        for (let i = 0; i < items.length; i++) {

            const item = items[i]
            newItems.push(item)
            const next = items[i + 1]

            if (next && item.txt && next.type === 'chat-clicked' && next.txt !== ' ') {
                newItems.push(...onFinished('(click chat to continue)'))
            }
        }

        return newItems
    }

    function flatten(items) {
        const res = []
        for (const item of items) {
            if (item instanceof Array) {
                res.push(...item)
            } else {
                res.push(item)
            }
        }
        return res
    }

    function onBubble(txt) {
        return {
            type: 'bubble-clicked',
            txt
        }
    }

    function onChatClicked() {
        return [].slice.call(arguments).map((arg, i) => ({
            type: i == 0 ? 'chat-clicked' : 'bot-finished',
            txt: arg
        }))
    }

    function onChatClickedToNextSection() {
        return {
            type: 'chat-clicked',
            go2nextSection: true
        }
    }

    function onFinished() {
        return [].slice.call(arguments).map(arg => ({
            type: 'bot-finished',
            txt: arg
        }))
    }

    function onCompileHovered(txt) {
        return {
            type: 'compile-hovered',
            txt
        }
    }
    function onStepClicked(txt) {
        return {
            type: 'step-clicked',
            txt
        }
    }
    function onCompileClicked(txt) {
        return {
            type: 'compile-clicked',
            txt
        }
    }

    function onCodeHovered(txt) {
        return {
            type: 'code-hovered',
            txt
        }
    }

    function onFinishedChangeLockAndAdvance(locked) {
        return {
            type: 'bot-finished',
            locked
        }
    }

    function onFinishedSetCodeAndAdvance(code) {
        return {
            type: 'bot-finished',
            code
        }
    }

    function onFinishedSetHighLightAndAdvance(highlighted) {
        return {
            type: 'bot-finished',
            highlighted
        }
    }

    function makeLock(cCode, compileBtn, stepBtn, runBtn) {
        return {
            cCode,
            compileBtn,
            stepBtn,
            runBtn
        }
    }

    function makeHighLights() {
        return [].slice.call(arguments).reduce((res, arg) => (res[arg] = true, res), {})
    }

    const scripts = [

        addClickToContinues(flatten([
            onBubble("Oh, Hi there!"),
            onFinished(
                'I\'m Jarvis and you\'re about to start your adventure inside the C programming language and the machine that runs it. ',
                'Feeling up to the challenge?'
            ),
            onChatClicked('  '),
            onFinishedSetCodeAndAdvance(`int main() {
    return 132 - 531;
}`),
            onFinished(
                'I knew it! There is some C code on the first column. Do you see it?',
                '(put your cursor on the C code to continue)'
            ),
            onCodeHovered('Yes, that\'s it. What do you think it means?'),
            onChatClicked(
                'It just says: "do 132 - 531 and then give me back the result"',
                'The C language is quite intuitive, isn\'t it? ',
                'The interesting part is how it all happens. Let\'s have a look.'
            ),
            onChatClicked(
                'Those 3 lines of code are called a "program". It\'s just a list of steps for the computer to follow.',
                'After you write a program like that, some kind of machine has to read it and follow the steps.',
                'That\'s the whole point of programming. Hopefully the machine can do it faster and/or easier than yourself.'
            ),
            onChatClicked(
                'You might be wondering what do I mean by "machine".',
                'Well, something that I can give a list of numbers, start it, and then it gives me a list of numbers back.',
                'It\'s that simple.'
            ),
            onChatClicked(
                'Your computer is a machine just as I described it above, with just a few extra flavor on top.',
                'We call the numbers (that the machine works with) "memory".',
                'After figuring out what the new numbers should be, only a few of them actually change and this is what the "processor" or CPU\'s job is: reading some numbers from memory, figuring out which have to change, and changing them.',
                'After that, it doesn\'t stop, it goes on. We are about to see how.',
                'We are going to look at what the processor does, how the memory looks like along the way, and how programming languages such as C can work under the hood.'
            ),
            onChatClicked(
                'We use numbers and not something else because it\'s not that hard to make circuits that say, add two numbers.',
                'I don\'t know about you though, but I would quickly lose my mind if I had to write numbers into a computer all day.',
                'But here is an idea. Write a program in something that looks more like English than plain numbers (such as that C code over there).',
                'Then turn the C code into numbers, then give the numbers to the machine.'
            ),
            onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
            onChatClicked(
                'See that "Compile" button?',
                '(click "Compile" to continue)'
            ),
            onCompileClicked('WOW! Lot\'s of things going on.'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinishedSetHighLightAndAdvance(makeHighLights(3, 4, 5)),
            onFinished(
                'The 3rd, 4th and 5th columns are parts of the memory of our machine.',
                'It has 50.000 slots (0 to 49.999) where it can store numbers and we call these slots "addresses".',
                'The left number is address of the number and the right is the actual number stored at that address.',
                'For instance, the number at address 10.006 is 1028.',
                'There are also 4 other special slots called "registers" (we will talk about them shortly).',
            ),
            onChatClicked('The 3rd column shows the memory from 10.000 to 10.024.'),
            onFinishedSetHighLightAndAdvance(makeHighLights(3)),
            onFinished(
                'When you hit "Compile", the 3 lines of C code were turned into the numbers 1000, 0, 1002, 2...1001, 0 and those numbers were inserted at the addresses 10.000 - 10.010. All the other numbers are 0s (except the registers).',
                'We say that a "compiler" "compiles" our program, which just means that it checks the code is correct (we will expand on that) and if so, it translates it into numbers.'
            ),
            onChatClicked(
                'Once you know C, we will look closer at the compiler and write a piece of it. ',
                'We call the memory section from address 10.000 to the last instruction (10.010 in this case), the "code segment".'
            ),
            onChatClicked(
                'How our machine (like most real processors) works is that when we give it the numbers and start it, it checks what number is at a certain memory address and depending on what\'s there, it then changes some other numbers. So many numbers! I know. The number that tells the machine what to do is called an "instruction".',
                'For instance, there is a "PUSH" instruction at address 10.004. Of course the machine has no idea what a "PUSH" is, it only knows what to do when it sees number 1002.',
            ),
            onChatClicked(
                'For us though, it\'s easier to read and write "PUSH, PLUS, or RET" instead of "1002, 1021, or 1001"',
                'When the machine looks at an instruction and does something, we say it\'s "executing" that instruction.',
                'We will see along the way what each instruction does.'
            ),
            onChatClicked(
                'So how does the machine know where to look for the instruction to execute?',
                'One of the 4 registers is IP, or the "instruction pointer".',
                'IP "points" to (holds the address of) the instruction that our machine will execute next.',
            ),
            onChatClicked('Right now, IP holds the number 10.000, the address of the first instruction generated from our C code.'),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr10000')),
            onChatClicked(
                'The address with a light blue background is always the number held by IP.',
                'This machine always starts with IP set to 10.000.'
            ),
            onChatClicked(' '),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr10007', 'adr10008', 'adr10006')),
            onChatClicked(
                'There are 20 or so instructions and some of them have "arguments".',
                'What that means is that right after the instruction there is a number (the argument) that is taken into consideration when the instruction is executed.',
                'The "RET" instruction is always followed by its argument. The one at address 10.007, has an argument of 0 (found at 10.008).',
                'The MINUS instruction at 10.006 is immediately followed by the next instruction, because it has no argument.'
            ),
            onChatClicked(
                'After executing an instruction, the machine will increase IP by 2 if the instruction had an argument or by 1 if it didn\'t.',
                'So the machine has to know, just like us, which instructions have an argument and which don\'t.',
                'It "thinks": "When I see number 1002 (that\'s a PUSH for us humans), then I will increase IP by 2, then I will use the argument right after to execute it. Then I am ready of the next instruction."',
                '"When I see number 1028 (MINUS for us), I know to increase IP by 1 (because MINUS has no argument), and then I will execute the instruction and then I am ready for the next one."'
            ),
            onChatClicked('The 2nd column is a mix between the 1st and the 3rd.'),
            onFinishedSetHighLightAndAdvance(makeHighLights(2)),
            onFinished(
                'It shows the lines of C code, each followed by the instructions generated from that line.',
                'Note that, unlike the 3rd column, the arguments go together with the instruction.',
                'For instance, at address 10.002 on the second column, there is a PUSH 132, and on the next line there\'s address 10.004.',
                'The 2nd column is just a nicer way of representing the 3rd.'
            ),
            onChatClicked(
                'Executing an instruction will almost always change something on the 4th column.'
            ),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr30000')),
            onFinished(
                'Right now, there are two registers holding the value 30.000, SP (stack pointer) and BP (base pointer). They always start at 30.000 on this machine.',
                'The purple highlights the base pointer and orange highlights the stack pointer (you can\'t clearly see the colors right now because they overlap).'
            ),
            onChatClicked(
                'We call the memory section from 30.000 to the the value of SP "the stack segment", or simply the "stack".',
                'Almost all the action happens on the stack, so let\'s give it a spin!',
                '(keep your eye on SP and BP (both at address 30000) and click "Step" to execute the 1st instruction)'
            ),

            onFinishedSetHighLightAndAdvance(makeHighLights()),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'The machine just executed the first instruction (FSTART) with the argument 0, or FSTART 0 for short.',
                'IP predictably increased to 10.002 to prepare for the next instruction: PUSH.',
                'SP and BP both moved to 30.001 and the value 30.000 was written at 30.001.'
            ),
            onFinished(
                'We will cover FSTART in detail later, what we are really interested in now are PUSH and MINUS.',
                '(keep an eye on SP (at 30.001) and click "Step" to execute the 2nd instruction: PUSH 132)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'PUSH 132 was executed. IP increased by 2 and and now we see SP was increased by 1 and now points to 30.002.',
                'Also, the value at SP (30.002) is now 132.',
                'The number 132 was "pushed" on to the stack, we say.',
                '(keep an eye on SP (at 30.002) and click "Step" to execute the 3nd instruction: PUSH 531)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'PUSH 531 was executed: IP increased once again by 2 and the number 531 was also pushed on to the stack.',
                '(keep an eye on SP and click "Step" to execute the 4th instruction: MINUS)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'MINUS was executed and the number (531) pointed by SP (30.003) was subtracted from 132 found at address SP-1, then SP was decreased and the result of the subtraction (-399) was stored at the new address where SP points: 30.002.',
                'Notice 531 is still at 30.003. There is no point in removing it. If we end up PUSHing something later, it will be overwritten anyway.',
                '(click "Step" to execute the next instruction (RET) that will terminate the program)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'We will cover RET in detail later, but for now, RET will end our program and whatever value is at address SP (-399 in this case), will be considered as the result of the execution.',
                'By the way, we call the value at address SP, the "top of the stack"',
                'Oh, and choosing numbers like 10.000 (initial IP), 30.000 (initial SP) or 1002 (PUSH) is up to whoever made the machine. It doesn\'t matter too much.'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, false, false, true)),
            onFinished(' '),
            onChatClicked(
                'This seems like a pretty complicated way to subtract two numbers.',
                'It\'s this way because must also work with longer calculations such as (1-532*32)/53. You\'re about to see how.',
                'Feel free free to compile and step through the small program we just covered until you are ready to move forward to the next section.',
            ),
            onChatClickedToNextSection()
        ])),

        addClickToContinues(flatten([
            onBubble('TODO')
            /*
    
            when talking about p langs, 132 - 531 is an expression
            132 is also
            (1-532*32)/53 is also
    
            Let\'s follow the thought process of the compiler at it turned the expression "132 - 531" into "PUSH 132, PUSH 531, MINUS"
    
            so an expression can be :
                a number: 2
                an expression followed by an operator (like +) and then another expression: 2+2
                '(' followed by and expression and then ')': (2+2)
    
            132 531 - is the postfix notation of the expression
            a longer expr(with a paren) e has a postfix notation of pe
            the compiler just finds the postfix notation and then runs the numbers into PUSH nr and the operators into their equivalent expressions
            not all machines / compilers work this way but it\'s a straightforward way to do it. Java and C# work this way.
    
            lets see what this longer expression should compile to
    
            <complie and awe in wonder that we know how the compiler works>
    
            it doesn\'t matter how big our expression is, because, in posfix notation:
    
                any expression is made out of 2 smaller expressions and then an operator
                to execute (we also say evaluate) any expression all we need to to is
                     evaluate the first subexpression (at this point the stack looks as if we just pushed the result of the first subexpression, no matter how big the first subexpression is)
                     evaluate the 2nd subexpression (this won't disturb the result of the first and after doing this it s as it we pushed the results of the the two subexpressions)
                     execute the instruction coresponding to the operator of the expression that will replace the 2 values with one: the result
    
                if you are not convinced, try and step through the execution of any long expression in <the playground> where you put any C code you like.
    
    
            so now we have a good understanding expressions.
    
            cover all operators
    
            
            // the lang bit by bit, syntax and semantics on the way
    
            // vars
            // stmts
            // arrays - why does it start from 0
            // strings 
                hide the 3rd coumn and replace it with the data seg
                some exercises  about how does the compiler work
                    "that's a compiler, jus takes some numbers into memoery and turns them into other numbers in memory"
    
            // functions 
                stack is like a hierarchical todo list
            
            no you see how programming works under the hood better than msot programmers, no practice (compiler errors, writing algorithms)
            if you want to program for a living, now it\'s the time to exercise: links with topics covered and where to go from here
            */
        ]))

    ]

    const script = scripts[window.location.search.substr(1)] || { noScript: true }
}
