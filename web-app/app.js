(function () {
  const EDGE_MODE_ALL = 'all'
  const EDGE_MODE_LAST = 'last'

  const FAN_OUT_COLOR = '#d73a49'
  const FAN_IN_COLOR = '#1f6feb'

  const COUPLING_METRICS = [
    { id: 'file-coupling', label: 'File Coupling', level: 'file' },
    { id: 'class-coupling', label: 'Class Coupling', level: 'class' },
    { id: 'function-coupling', label: 'Function Coupling', level: 'function' }
  ]

  const METRIC_COLOR_BY_ID = {
    'file-coupling': '#7dd3fc',
    'class-coupling': '#38bdf8',
    'function-coupling': '#0284c7'
  }

  const state = {
    result: null,
    sourceType: null,
    selectedMetricIds: [],
    edgeMode: EDGE_MODE_ALL,
    lineThresholdByMetricId: {
      'file-coupling': 0,
      'class-coupling': 0,
      'function-coupling': 0
    }
  }

  const METRIC_BASE_URL = (() => {
    const configured = window.__VTJMETRICS_METRIC_BASE_URL || '../chrome-extension/metric-src/'
    try {
      return new URL(String(configured), window.location.href).href
    } catch {
      return String(configured)
    }
  })()

  function byId (id) {
    return document.getElementById(id)
  }

  function setStatus (text, type) {
    const status = byId('status')
    status.textContent = text
    status.dataset.type = type || 'info'
  }

  function setBusy (busy) {
    byId('run-btn').disabled = busy
    byId('download-btn').disabled = busy
    byId('run-btn').textContent = busy ? 'Calculating...' : 'Calculate metrics'
  }

  function truncateMiddle (value, max) {
    if (!value || value.length <= max) return value
    const head = Math.ceil((max - 3) / 2)
    const tail = Math.floor((max - 3) / 2)
    return `${value.slice(0, head)}...${value.slice(value.length - tail)}`
  }

  function shortPathLabel (path) {
    if (!path) return '(unknown)'
    const parts = path.split('/').filter(Boolean)
    if (parts.length <= 2) return path
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }

  function toArrayUniqueStrings (value) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter(item => typeof item === 'string'))]
  }

  function sumNumericValues (obj) {
    if (!obj || typeof obj !== 'object') return 0
    return Object.values(obj).reduce((acc, value) => acc + (typeof value === 'number' ? value : 0), 0)
  }

  function toNonNegativeInt (value, fallback = 0) {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return fallback
    return Math.floor(n)
  }

  function getMetricLabel (metricId) {
    return COUPLING_METRICS.find(metric => metric.id === metricId)?.label || metricId
  }

  function getThresholdForMetric (metricId) {
    return toNonNegativeInt(state.lineThresholdByMetricId?.[metricId], 0)
  }

  function getClassesPerFileResult () {
    return state.result?.['classes-per-file']?.result || {}
  }

  function getFunctionsPerFileResult () {
    return state.result?.['functions-per-file']?.result || {}
  }

  function getLinesPerFileResult () {
    return state.result?.['lines-per-file']?.result || {}
  }

  function getFunctionLengthResult () {
    return state.result?.['function-length']?.result || {}
  }

  function getLocStartLine (node) {
    const line = node?.loc?.start?.line
    return Number.isFinite(line) ? line : null
  }

  function getLocEndLine (node) {
    const line = node?.loc?.end?.line
    return Number.isFinite(line) ? line : null
  }

  function estimateNodeLineCount (node) {
    const start = getLocStartLine(node)
    const end = getLocEndLine(node)
    if (start != null && end != null && end >= start) return end - start + 1
    return null
  }

  function buildClassInfoMap () {
    const output = new Map()
    const classesPerFile = getClassesPerFileResult()

    for (const [filePath, classes] of Object.entries(classesPerFile || {})) {
      for (const [className, methods] of Object.entries(classes || {})) {
        const entityId = `${filePath}::${className}`
        const methodsArray = Array.isArray(methods) ? methods : []

        let minLine = null
        let maxLine = null

        for (const methodNode of methodsArray) {
          const start = getLocStartLine(methodNode)
          const end = getLocEndLine(methodNode)
          if (start != null) minLine = minLine == null ? start : Math.min(minLine, start)
          if (end != null) maxLine = maxLine == null ? end : Math.max(maxLine, end)
        }

        const spanLines = minLine != null && maxLine != null && maxLine >= minLine
          ? (maxLine - minLine + 1)
          : null

        output.set(entityId, {
          filePath,
          className,
          methods: methodsArray.length,
          startLine: minLine || 1,
          lines: spanLines != null ? spanLines : Math.max(1, methodsArray.length)
        })
      }
    }

    return output
  }

  function getFunctionInfo (filePath, functionName) {
    const functionLengthResult = getFunctionLengthResult()
    const functionsPerFileResult = getFunctionsPerFileResult()

    const lineCount = toNonNegativeInt(functionLengthResult?.[filePath]?.[functionName]?.lines, 0)
    const node = functionsPerFileResult?.[filePath]?.[functionName]
    const startLine = getLocStartLine(node) || 1
    const fallbackLines = estimateNodeLineCount(node)

    return {
      startLine,
      lines: lineCount > 0 ? lineCount : Math.max(1, fallbackLines || 0)
    }
  }

  function getFileLineInfo (filePath) {
    const lineInfo = getLinesPerFileResult()?.[filePath]
    return {
      startLine: 1,
      lines: toNonNegativeInt(lineInfo?.total, 0),
      nonEmpty: toNonNegativeInt(lineInfo?.nonEmpty, 0),
      blank: toNonNegativeInt(lineInfo?.blank, 0)
    }
  }

  function buildClassNameToEntityMap (result) {
    const map = new Map()

    for (const [filePath, classes] of Object.entries(result || {})) {
      if (!classes || typeof classes !== 'object') continue
      for (const className of Object.keys(classes)) {
        if (!map.has(className)) map.set(className, `${filePath}::${className}`)
      }
    }

    return map
  }

  function buildFunctionNameToEntityMap (result) {
    const map = new Map()

    for (const [filePath, functions] of Object.entries(result || {})) {
      if (!functions || typeof functions !== 'object') continue
      for (const functionName of Object.keys(functions)) {
        if (!map.has(functionName)) map.set(functionName, `${filePath}::${functionName}`)
      }
    }

    return map
  }

  function buildFunctionClassMap () {
    const output = {}
    const raw = state.result?.['classes-per-file']?.result
    if (!raw || typeof raw !== 'object') return output

    for (const [filePath, classes] of Object.entries(raw)) {
      output[filePath] = output[filePath] || {}

      for (const [className, methods] of Object.entries(classes || {})) {
        const classEntityId = `${filePath}::${className}`

        for (const methodNode of Array.isArray(methods) ? methods : []) {
          const methodName = methodNode?.key?.name
          if (!methodName) continue

          if (!(methodName in output[filePath])) {
            output[filePath][methodName] = classEntityId
          } else if (output[filePath][methodName] !== classEntityId) {
            output[filePath][methodName] = null
          }
        }
      }
    }

    return output
  }

  function extractFileCouplingGraph () {
    const result = state.result?.['file-coupling']?.result || {}
    const nodes = []
    const links = []

    for (const [filePath, coupling] of Object.entries(result)) {
      const fanIn = toArrayUniqueStrings(coupling?.fanIn)
      const fanOut = toArrayUniqueStrings(coupling?.fanOut)
      const lineInfo = getFileLineInfo(filePath)

      nodes.push({
        metricId: 'file-coupling',
        entityId: filePath,
        filePath,
        label: shortPathLabel(filePath),
        fullLabel: filePath,
        value: Math.max(1, fanIn.length + fanOut.length),
        fanIn: fanIn.length,
        fanOut: fanOut.length,
        lines: lineInfo.lines,
        startLine: 1
      })

      for (const target of fanOut) {
        links.push({
          metricId: 'file-coupling',
          sourceEntity: filePath,
          targetEntity: target,
          weight: 1
        })
      }
    }

    return { metricId: 'file-coupling', level: 'file', nodes, links, warnings: [] }
  }

  function extractClassCouplingGraph () {
    const result = state.result?.['class-coupling']?.result || {}
    const warnings = []
    const nodes = []
    const links = []
    const classInfoMap = buildClassInfoMap()
    const classNameToEntity = buildClassNameToEntityMap(result)
    const outWeightsBySourceEntity = new Map()

    for (const [filePath, classes] of Object.entries(result)) {
      if (!classes || typeof classes !== 'object') continue

      for (const [className, methods] of Object.entries(classes)) {
        const methodsArray = Array.isArray(methods) ? methods : []
        const entityId = `${filePath}::${className}`
        let fanInCalls = 0
        let fanOutCalls = 0

        outWeightsBySourceEntity.set(entityId, outWeightsBySourceEntity.get(entityId) || new Map())

        for (const methodNode of methodsArray) {
          const fanInMap = methodNode?.['fan-in'] || {}
          const fanOutMap = methodNode?.['fan-out'] || {}

          for (const [targetClass, targetMethods] of Object.entries(fanOutMap)) {
            const weight = sumNumericValues(targetMethods)
            fanOutCalls += weight
            const sourceMap = outWeightsBySourceEntity.get(entityId)
            sourceMap.set(targetClass, (sourceMap.get(targetClass) || 0) + weight)
          }

          for (const methodMap of Object.values(fanInMap)) {
            fanInCalls += sumNumericValues(methodMap)
          }
        }

        nodes.push({
          metricId: 'class-coupling',
          entityId,
          filePath,
          className,
          label: className,
          fullLabel: `${className} (${shortPathLabel(filePath)})`,
          value: Math.max(1, fanInCalls + fanOutCalls),
          fanIn: fanInCalls,
          fanOut: fanOutCalls,
          lines: classInfoMap.get(entityId)?.lines || 0,
          startLine: classInfoMap.get(entityId)?.startLine || 1,
          methods: classInfoMap.get(entityId)?.methods || methodsArray.length
        })
      }
    }

    for (const [sourceEntity, targetMap] of outWeightsBySourceEntity.entries()) {
      for (const [targetClassName, weight] of targetMap.entries()) {
        const targetEntity = classNameToEntity.get(targetClassName)
        if (!targetEntity) {
          warnings.push(`Class-coupling target not found: ${targetClassName}`)
          continue
        }
        links.push({
          metricId: 'class-coupling',
          sourceEntity,
          targetEntity,
          weight: Math.max(1, weight)
        })
      }
    }

    return { metricId: 'class-coupling', level: 'class', nodes, links, warnings }
  }

  function extractFunctionCouplingGraph () {
    const result = state.result?.['function-coupling']?.result || {}
    const warnings = []
    const nodes = []
    const links = []

    const functionClassMap = buildFunctionClassMap()
    const functionNameToEntity = buildFunctionNameToEntityMap(result)
    const outWeightsBySourceEntity = new Map()

    for (const [filePath, functions] of Object.entries(result)) {
      if (!functions || typeof functions !== 'object') continue

      for (const [functionName, functionNode] of Object.entries(functions)) {
        const entityId = `${filePath}::${functionName}`
        const fanInMap = functionNode?.['fan-in'] || {}
        const fanOutMap = functionNode?.['fan-out'] || {}
        const fanInCalls = sumNumericValues(fanInMap)
        const fanOutCalls = sumNumericValues(fanOutMap)
        const fnInfo = getFunctionInfo(filePath, functionName)

        nodes.push({
          metricId: 'function-coupling',
          entityId,
          filePath,
          functionName,
          label: functionName,
          fullLabel: `${functionName} (${shortPathLabel(filePath)})`,
          classEntityId: functionClassMap[filePath]?.[functionName] || null,
          value: Math.max(1, fanInCalls + fanOutCalls),
          fanIn: fanInCalls,
          fanOut: fanOutCalls,
          lines: fnInfo.lines,
          startLine: fnInfo.startLine
        })

        const outMap = outWeightsBySourceEntity.get(entityId) || new Map()
        outWeightsBySourceEntity.set(entityId, outMap)

        for (const [targetFunctionName, weight] of Object.entries(fanOutMap)) {
          const numeric = typeof weight === 'number' ? weight : 0
          outMap.set(targetFunctionName, (outMap.get(targetFunctionName) || 0) + numeric)
        }
      }
    }

    for (const [sourceEntity, targetMap] of outWeightsBySourceEntity.entries()) {
      for (const [targetFunctionName, weight] of targetMap.entries()) {
        const targetEntity = functionNameToEntity.get(targetFunctionName)
        if (!targetEntity) {
          warnings.push(`Function-coupling target not found: ${targetFunctionName}`)
          continue
        }

        links.push({
          metricId: 'function-coupling',
          sourceEntity,
          targetEntity,
          weight: Math.max(1, weight)
        })
      }
    }

    return { metricId: 'function-coupling', level: 'function', nodes, links, warnings }
  }

  function buildGraphByMetricId (metricId) {
    if (metricId === 'file-coupling') return extractFileCouplingGraph()
    if (metricId === 'class-coupling') return extractClassCouplingGraph()
    if (metricId === 'function-coupling') return extractFunctionCouplingGraph()
    return null
  }

  function resolveParentEntityId (childNode, childLevel, parentLevel) {
    if (!parentLevel) return null
    if (childLevel === 'class' && parentLevel === 'file') return childNode.filePath
    if (childLevel === 'function' && parentLevel === 'class') return childNode.classEntityId || null
    if (childLevel === 'function' && parentLevel === 'file') return childNode.filePath
    return null
  }

  function buildVisualizationModel (selectedMetricIds, edgeMode) {
    const graphList = []
    const warnings = []

    for (const metricId of selectedMetricIds) {
      const graph = buildGraphByMetricId(metricId)
      if (!graph) continue

      const threshold = getThresholdForMetric(metricId)
      const filteredNodes = graph.nodes.filter((node) => toNonNegativeInt(node.lines, 0) >= threshold)
      const entitySet = new Set(filteredNodes.map(node => node.entityId))
      const filteredLinks = graph.links.filter(link => entitySet.has(link.sourceEntity) && entitySet.has(link.targetEntity))

      if (graph.nodes.length > 0 && filteredNodes.length === 0) {
        warnings.push(`${getMetricLabel(metricId)}: no elements match min lines >= ${threshold}`)
      }

      graphList.push({ ...graph, nodes: filteredNodes, links: filteredLinks, threshold })
      warnings.push(...graph.warnings)
    }

    const root = { key: 'root', label: 'Project', value: 1, children: [] }
    const treeByKey = new Map([['root', root]])

    for (let index = 0; index < graphList.length; index++) {
      const graph = graphList[index]
      const parentGraph = graphList[index - 1]

      for (const node of graph.nodes) {
        const key = `${graph.metricId}|${node.entityId}`
        if (treeByKey.has(key)) continue

        let parentKey = 'root'
        if (parentGraph) {
          const parentEntityId = resolveParentEntityId(node, graph.level, parentGraph.level)
          const candidateKey = parentEntityId ? `${parentGraph.metricId}|${parentEntityId}` : null
          if (candidateKey && treeByKey.has(candidateKey)) parentKey = candidateKey
        }

        const parent = treeByKey.get(parentKey) || root
        const treeNode = {
          key,
          metricId: graph.metricId,
          entityId: node.entityId,
          label: node.label,
          value: Math.max(1, node.value || 1),
          meta: node,
          children: []
        }

        parent.children.push(treeNode)
        treeByKey.set(key, treeNode)
      }
    }

    const visibleMetricIds = edgeMode === EDGE_MODE_LAST
      ? (graphList.length > 0 ? [graphList[graphList.length - 1].metricId] : [])
      : graphList.map(graph => graph.metricId)

    const links = []
    for (const graph of graphList) {
      if (!visibleMetricIds.includes(graph.metricId)) continue
      for (const link of graph.links) {
        const sourceKey = `${graph.metricId}|${link.sourceEntity}`
        const targetKey = `${graph.metricId}|${link.targetEntity}`
        if (!treeByKey.has(sourceKey) || !treeByKey.has(targetKey)) continue
        links.push({ ...link, sourceKey, targetKey })
      }
    }

    return {
      graphList,
      hierarchy: root,
      links,
      warnings: [...new Set(warnings)].slice(0, 10)
    }
  }

  function renderWarnings (warnings) {
    const node = byId('warnings')
    if (!warnings || warnings.length === 0) {
      node.hidden = true
      node.textContent = ''
      return
    }

    node.hidden = false
    node.textContent = `Notes: ${warnings.join(' | ')}`
  }

  function renderLegend (graphList) {
    const node = byId('legend')
    if (!graphList || graphList.length === 0) {
      node.innerHTML = ''
      return
    }

    const flowLegend = `
      <span class="legend-chip"><span class="legend-line" style="background:${FAN_OUT_COLOR}"></span>Fan-Out</span>
      <span class="legend-chip"><span class="legend-line" style="background:${FAN_IN_COLOR}"></span>Fan-In</span>
    `

    const chips = graphList.map((graph, index) => {
      const color = METRIC_COLOR_BY_ID[graph.metricId] || '#57606a'
      return `<span class="legend-chip"><span class="legend-swatch" style="background:${color}"></span>${index + 1}. ${getMetricLabel(graph.metricId)} (min lines: ${graph.threshold || 0})</span>`
    }).join('')

    node.innerHTML = flowLegend + chips
  }

  function updateDetails (html) {
    byId('viz-details').innerHTML = html
  }

  function getSvgSize (container) {
    const width = Math.max(760, Math.min(1320, Math.floor(container.clientWidth || 900)))
    const height = Math.max(520, Math.floor(width * 0.62))
    return { width, height }
  }

  function renderVisualization () {
    const canvas = byId('viz-canvas')
    const emptyMessage = byId('viz-empty')
    canvas.innerHTML = ''

    if (!state.result) {
      emptyMessage.hidden = false
      emptyMessage.textContent = 'Run metrics first, then choose one or more coupling metrics.'
      renderWarnings([])
      renderLegend([])
      return
    }

    const selectedIds = state.selectedMetricIds.slice()
    if (selectedIds.length === 0) {
      emptyMessage.hidden = false
      emptyMessage.textContent = 'Select at least one coupling metric to render.'
      renderWarnings([])
      renderLegend([])
      return
    }

    const model = buildVisualizationModel(selectedIds, state.edgeMode)

    const hasNodes = model.graphList.some(graph => graph.nodes.length > 0)
    if (!hasNodes) {
      emptyMessage.hidden = false
      emptyMessage.textContent = 'No elements match current filters. Lower min lines threshold.'
      renderWarnings(model.warnings)
      renderLegend(model.graphList)
      return
    }

    emptyMessage.hidden = true
    renderLegend(model.graphList)
    renderWarnings(model.warnings)

    const { width, height } = getSvgSize(canvas)
    const svg = d3.select(canvas)
      .append('svg')
      .attr('class', 'vtjmetrics-svg')
      .attr('viewBox', `0 0 ${width} ${height}`)

    const root = d3.hierarchy(model.hierarchy).sum(d => Math.max(1, d.value || 1))

    d3.pack()
      .size([width - 16, height - 16])
      .padding(12)(root)

    root.each(node => {
      node.x += 8
      node.y += 8
    })

    const nodeByKey = new Map()
    const circles = root.descendants().filter(node => node.data.key !== 'root')

    for (const node of circles) nodeByKey.set(node.data.key, node)

    const resolvedLinks = model.links
      .map(link => ({ ...link, sourceNode: nodeByKey.get(link.sourceKey), targetNode: nodeByKey.get(link.targetKey) }))
      .filter(link => link.sourceNode && link.targetNode)

    const proportionalLinks = resolvedLinks.map((link) => {
      const edgeWeight = Math.max(0, link.weight || 0)
      const sourceOut = Math.max(0, toNonNegativeInt(link.sourceNode?.data?.meta?.fanOut, 0))
      const sourceIn = Math.max(0, toNonNegativeInt(link.sourceNode?.data?.meta?.fanIn, 0))
      return {
        ...link,
        edgeWeight,
        outFlow: sourceOut,
        inFlow: sourceIn,
        totalNodeFlow: sourceOut + sourceIn
      }
    })

    const maxEdgeWeight = Math.max(1, ...proportionalLinks.map(link => link.edgeWeight || 1))
    const widthScale = d3.scaleSqrt().domain([1, maxEdgeWeight]).range([2.8, 12])

    for (const link of proportionalLinks) {
      const totalStroke = widthScale(link.edgeWeight || 1)
      const N = Math.max(1, link.totalNodeFlow)
      const outRatio = link.outFlow > 0 ? (link.outFlow / N) : 0
      const inRatio = link.inFlow > 0 ? (link.inFlow / N) : 0
      link.outWidth = link.outFlow > 0 ? Math.max(1, totalStroke * outRatio) : 0
      link.inWidth = link.inFlow > 0 ? Math.max(1, totalStroke * inRatio) : 0
    }

    const defs = svg.append('defs')
    const markerSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const outArrowId = `vtj-arrow-out-${markerSuffix}`
    const inArrowId = `vtj-arrow-in-${markerSuffix}`

    function appendArrowMarker (id, color) {
      defs.append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -4 8 8')
        .attr('refX', 5.4)
        .attr('refY', 0)
        .attr('markerUnits', 'userSpaceOnUse')
        .attr('markerWidth', 3.8)
        .attr('markerHeight', 3.8)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-2.4L4.6,0L0,2.4')
        .attr('fill', color)
        .attr('opacity', 0.9)
    }

    appendArrowMarker(outArrowId, FAN_OUT_COLOR)
    appendArrowMarker(inArrowId, FAN_IN_COLOR)

    const linksGroup = svg.append('g').attr('class', 'vtjmetrics-links')
    const linkSelection = linksGroup.selectAll('g').data(proportionalLinks).enter().append('g')

    const fanOutSelection = linkSelection.append('line')
      .attr('stroke', FAN_OUT_COLOR)
      .attr('stroke-width', d => d.outWidth)
      .attr('marker-end', `url(#${outArrowId})`)
      .attr('stroke-linecap', 'round')
      .attr('stroke-opacity', 0.9)
      .style('display', d => d.outFlow > 0 ? null : 'none')

    const fanInSelection = linkSelection.append('line')
      .attr('stroke', FAN_IN_COLOR)
      .attr('stroke-width', d => d.inWidth)
      .attr('marker-end', `url(#${inArrowId})`)
      .attr('stroke-linecap', 'round')
      .attr('stroke-opacity', 0.9)
      .style('display', d => d.inFlow > 0 ? null : 'none')

    function getSegmentPoints (link) {
      const source = link.sourceNode
      const target = link.targetNode
      const dx = target.x - source.x
      const dy = target.y - source.y
      const dist = Math.max(1, Math.hypot(dx, dy))
      const ux = dx / dist
      const uy = dy / dist

      const sourcePad = source.r + 2
      const targetPad = target.r + 2
      const visibleDistance = Math.max(1, dist - sourcePad - targetPad)
      const sx = source.x + ux * sourcePad
      const sy = source.y + uy * sourcePad
      const tx = sx + ux * visibleDistance
      const ty = sy + uy * visibleDistance
      const mx = (sx + tx) / 2
      const my = (sy + ty) / 2

      return { sx, sy, mx, my, tx, ty }
    }

    function updateLinkGeometry () {
      fanOutSelection
        .attr('x1', d => getSegmentPoints(d).sx)
        .attr('y1', d => getSegmentPoints(d).sy)
        .attr('x2', d => getSegmentPoints(d).mx)
        .attr('y2', d => getSegmentPoints(d).my)

      fanInSelection
        .attr('x1', d => getSegmentPoints(d).mx)
        .attr('y1', d => getSegmentPoints(d).my)
        .attr('x2', d => getSegmentPoints(d).tx)
        .attr('y2', d => getSegmentPoints(d).ty)
    }

    updateLinkGeometry()

    const circlesGroup = svg.append('g')
    const nodeSelection = circlesGroup.selectAll('g').data(circles).enter().append('g')
      .attr('transform', d => `translate(${d.x},${d.y})`)

    const maxNodeValueByMetric = new Map()
    for (const node of circles) {
      const metricId = node.data.metricId
      const value = toNonNegativeInt(node.data.meta?.value, 1)
      maxNodeValueByMetric.set(metricId, Math.max(maxNodeValueByMetric.get(metricId) || 1, value))
    }

    function getNodeVisualColor (node) {
      const metricId = node.data.metricId
      const baseColor = METRIC_COLOR_BY_ID[metricId] || '#64748b'
      const value = toNonNegativeInt(node.data.meta?.value, 1)
      const maxValue = Math.max(1, maxNodeValueByMetric.get(metricId) || 1)
      let strength = Math.max(0.16, Math.min(1, value / maxValue))
      if (node.children && node.children.length > 0) strength = Math.max(0.12, strength * 0.78)
      return d3.interpolateRgb('#f8fbff', baseColor)(strength)
    }

    nodeSelection.append('circle')
      .attr('r', d => d.r)
      .attr('fill', d => getNodeVisualColor(d))
      .attr('stroke', d => {
        const fill = d3.color(getNodeVisualColor(d))
        if (!fill) return '#334155'
        return fill.darker(0.8).formatRgb()
      })
      .attr('stroke-width', d => Math.max(1.2, Math.min(3.2, d.r * 0.06)))

    nodeSelection.append('text')
      .attr('class', 'vtjmetrics-node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', d => Math.max(9, Math.min(15, d.r * 0.23)))
      .text(d => {
        if (d.r < 18) return ''
        return truncateMiddle(d.data.label || '', d.r > 52 ? 28 : 14)
      })

    let dragMoved = false
    const dragBehavior = d3.drag()
      .on('start', function (_event, d) {
        dragMoved = false
        d3.select(this).raise()
        updateDetails(`Dragging: <strong>${truncateMiddle(d.data.meta?.fullLabel || d.data.label, 80)}</strong>`)
      })
      .on('drag', function (event, d) {
        dragMoved = true

        function clampToContainer (node, x, y) {
          const margin = 6
          const parent = node.parent

          if (parent && parent.data?.key !== 'root') {
            const maxDist = Math.max(0, parent.r - node.r - margin)
            const dx = x - parent.x
            const dy = y - parent.y
            const dist = Math.hypot(dx, dy)
            if (dist > maxDist && dist > 0) {
              const ratio = maxDist / dist
              return { x: parent.x + dx * ratio, y: parent.y + dy * ratio }
            }
            return { x, y }
          }

          return {
            x: Math.max(node.r + margin, Math.min(width - node.r - margin, x)),
            y: Math.max(node.r + margin, Math.min(height - node.r - margin, y))
          }
        }

        const clamped = clampToContainer(d, event.x, event.y)
        const dx = clamped.x - d.x
        const dy = clamped.y - d.y

        for (const movedNode of d.descendants()) {
          movedNode.x += dx
          movedNode.y += dy
        }

        nodeSelection.attr('transform', node => `translate(${node.x},${node.y})`)
        updateLinkGeometry()
      })
      .on('end', function () {
        dragMoved = false
        updateDetails('Hover a circle to inspect details. Drag circles to reposition.')
      })

    nodeSelection.call(dragBehavior)

    nodeSelection
      .on('mouseenter', (_event, d) => {
        const metricLabel = getMetricLabel(d.data.metricId)
        const nodeMeta = d.data.meta || {}

        updateDetails(`
          <strong>${metricLabel}</strong><br>
          <span>${truncateMiddle(nodeMeta.fullLabel || d.data.label, 90)}</span><br>
          <span>Lines: <strong>${nodeMeta.lines ?? 0}</strong> | Start line: <strong>${nodeMeta.startLine ?? 1}</strong></span><br>
          <span>Fan-In: <strong>${nodeMeta.fanIn ?? 0}</strong> | Fan-Out: <strong>${nodeMeta.fanOut ?? 0}</strong></span><br>
          <span>Coupling score: <strong>${nodeMeta.value ?? 1}</strong></span>
        `)
      })
      .on('mouseleave', () => {
        updateDetails('Hover a circle to inspect details. Drag circles to reposition.')
      })
  }

  function hasMetricResultData (metricId) {
    const metric = state.result?.[metricId]
    return Boolean(metric && metric.result && typeof metric.result === 'object' && Object.keys(metric.result).length > 0)
  }

  function getAvailableCouplingMetrics () {
    return COUPLING_METRICS.filter(metric => hasMetricResultData(metric.id))
  }

  function renderMetricSelectOptions () {
    const select = byId('metric-select')
    const addButton = byId('add-metric-btn')
    const selectable = COUPLING_METRICS.filter(metric => !state.selectedMetricIds.includes(metric.id) && hasMetricResultData(metric.id))

    select.innerHTML = ''
    if (selectable.length === 0) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = state.result ? 'All available coupling metrics selected' : 'Run metrics first'
      select.appendChild(option)
      select.disabled = true
      addButton.disabled = true
      return
    }

    for (const metric of selectable) {
      const option = document.createElement('option')
      option.value = metric.id
      option.textContent = metric.label
      select.appendChild(option)
    }

    select.disabled = false
    addButton.disabled = false
  }

  function renderSelectedMetricList () {
    const listNode = byId('selected-list')
    listNode.innerHTML = ''

    if (state.selectedMetricIds.length === 0) {
      const item = document.createElement('li')
      item.className = 'selected-empty'
      item.textContent = 'No metrics selected yet.'
      listNode.appendChild(item)
      return
    }

    state.selectedMetricIds.forEach((metricId, index) => {
      const metric = COUPLING_METRICS.find(item => item.id === metricId)
      const item = document.createElement('li')
      item.className = 'selected-item'
      const color = METRIC_COLOR_BY_ID[metricId] || '#57606a'
      const threshold = getThresholdForMetric(metricId)

      item.innerHTML = `
        <div class="selected-main">
          <span class="selected-index">${index + 1}</span>
          <span class="selected-dot" style="background:${color}"></span>
          <span>${metric?.label || metricId}</span>
        </div>
        <div class="selected-threshold">
          <label>Min lines</label>
          <input type="number" min="0" step="1" data-action="threshold" data-metric-id="${metricId}" value="${threshold}" />
        </div>
        <div class="selected-actions">
          <button type="button" data-action="up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>Up</button>
          <button type="button" data-action="down" data-index="${index}" ${index === state.selectedMetricIds.length - 1 ? 'disabled' : ''}>Down</button>
          <button type="button" data-action="remove" data-index="${index}">Remove</button>
        </div>
      `

      listNode.appendChild(item)
    })
  }

  function renderControls () {
    renderMetricSelectOptions()
    renderSelectedMetricList()
    byId('edge-mode').value = state.edgeMode
  }

  function moveMetric (fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= state.selectedMetricIds.length) return
    const copy = [...state.selectedMetricIds]
    const [item] = copy.splice(fromIndex, 1)
    copy.splice(toIndex, 0, item)
    state.selectedMetricIds = copy
  }

  function parseGitHubUrl (input) {
    let parsed
    try {
      parsed = new URL(input)
    } catch {
      throw new Error('Invalid GitHub URL')
    }

    if (parsed.hostname !== 'github.com') throw new Error('URL must be from github.com')

    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length < 2) throw new Error('GitHub URL must include owner/repository')

    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/, '')

    let ref = 'HEAD'
    let inferredSourcePath = ''

    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      ref = decodeURIComponent(parts[3])
      inferredSourcePath = parts.slice(4).join('/')
      if (parts[2] === 'blob' && inferredSourcePath.includes('/')) {
        inferredSourcePath = inferredSourcePath.split('/').slice(0, -1).join('/')
      }
    }

    return { owner, repo, ref, inferredSourcePath }
  }

  async function readZipSources (file) {
    if (!file) throw new Error('Please select a ZIP file')
    if (!window.JSZip) throw new Error('JSZip did not load. Check internet access to CDN.')

    const zip = await window.JSZip.loadAsync(file)
    const filesByPath = {}

    const entries = Object.values(zip.files).filter(entry => !entry.dir)
    const allowedExts = new Set(['.js', '.cjs', '.ts', '.jsx', '.tsx', '.json'])

    for (const entry of entries) {
      const normalizedPath = entry.name.replace(/^\/+/, '')
      const dotIndex = normalizedPath.lastIndexOf('.')
      const ext = dotIndex >= 0 ? normalizedPath.slice(dotIndex).toLowerCase() : ''
      if (!allowedExts.has(ext)) continue

      const content = await entry.async('string')
      filesByPath[normalizedPath] = content
    }

    if (Object.keys(filesByPath).length === 0) {
      throw new Error('ZIP does not contain supported source files (.js, .cjs, .ts, .jsx, .tsx, .json)')
    }

    return filesByPath
  }

  async function calculateMetrics () {
    const sourcePathInput = byId('source-path').value.trim() || '.'
    const mode = document.querySelector('input[name="source-mode"]:checked')?.value || 'github'

    setBusy(true)
    setStatus('Running metrics...', 'info')

    try {
      let result

      if (mode === 'github') {
        const parsed = parseGitHubUrl(byId('repo-url').value.trim())
        const explicitRef = byId('repo-ref').value.trim()
        const sourcePath = sourcePathInput || parsed.inferredSourcePath || '.'

        result = await window.runJTMetricsInBrowser({
          owner: parsed.owner,
          repo: parsed.repo,
          ref: explicitRef || parsed.ref,
          sourcePath,
          githubToken: byId('github-token').value.trim(),
          metricBaseUrl: METRIC_BASE_URL
        })

        state.sourceType = `GitHub: ${parsed.owner}/${parsed.repo}`
      } else {
        const zipFile = byId('zip-file').files?.[0]
        const filesByPath = await readZipSources(zipFile)

        result = await window.runJTMetricsFromFilesInBrowser({
          filesByPath,
          sourcePath: sourcePathInput,
          projectName: byId('project-name').value.trim() || 'local-project',
          metricBaseUrl: METRIC_BASE_URL
        })

        state.sourceType = `ZIP: ${zipFile?.name || 'uploaded'}`
      }

      state.result = result

      const available = getAvailableCouplingMetrics().map(metric => metric.id)
      state.selectedMetricIds = state.selectedMetricIds.filter(metricId => available.includes(metricId))
      if (state.selectedMetricIds.length === 0 && available.length > 0) {
        state.selectedMetricIds = [available[0]]
      }

      renderControls()
      renderVisualization()
      byId('download-btn').hidden = false
      setStatus(`Done. ${state.sourceType}. Analyzed files: ${result?._meta?.analyzedFiles || 'n/a'}.`, 'success')
    } catch (error) {
      setStatus(`Failed: ${error?.message || 'Unknown error'}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  function downloadLatestResult () {
    if (!state.result) return
    const filename = `vtjmetrics-${Date.now()}.json`
    const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function bindEvents () {
    byId('run-btn').addEventListener('click', calculateMetrics)
    byId('download-btn').addEventListener('click', downloadLatestResult)
    byId('add-metric-btn').addEventListener('click', () => {
      const select = byId('metric-select')
      const metricId = select.value
      if (!metricId || state.selectedMetricIds.includes(metricId)) return
      state.selectedMetricIds.push(metricId)
      renderControls()
      renderVisualization()
    })

    byId('edge-mode').addEventListener('change', (event) => {
      state.edgeMode = event.target.value === EDGE_MODE_LAST ? EDGE_MODE_LAST : EDGE_MODE_ALL
      renderVisualization()
    })

    byId('selected-list').addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      const action = target.dataset.action
      if (!action) return

      const index = Number(target.dataset.index)
      if (!Number.isFinite(index)) return

      if (action === 'remove') {
        state.selectedMetricIds.splice(index, 1)
      } else if (action === 'up') {
        moveMetric(index, index - 1)
      } else if (action === 'down') {
        moveMetric(index, index + 1)
      }

      renderControls()
      renderVisualization()
    })

    byId('selected-list').addEventListener('input', (event) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.dataset.action !== 'threshold') return

      const metricId = target.dataset.metricId
      if (!metricId) return

      state.lineThresholdByMetricId[metricId] = toNonNegativeInt(target.value, 0)
      renderVisualization()
    })

    const radios = document.querySelectorAll('input[name="source-mode"]')
    radios.forEach((radio) => {
      radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="source-mode"]:checked')?.value || 'github'
        byId('github-mode').hidden = mode !== 'github'
        byId('zip-mode').hidden = mode !== 'zip'
      })
    })
  }

  function bootstrapDefaults () {
    state.selectedMetricIds = ['file-coupling']
    renderControls()
    renderVisualization()
  }

  bindEvents()
  bootstrapDefaults()
})()
