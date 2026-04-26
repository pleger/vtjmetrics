const VT_TAB_ID = 'vtjmetrics-tab-link'
const VT_PANEL_ID = 'vtjmetrics-panel'
const VT_STATUS_ID = 'vtjmetrics-status'
const VT_PATH_ID = 'vtjmetrics-source-path'
const VT_CALCULATE_ID = 'vtjmetrics-calculate-btn'
const VT_DOWNLOAD_ID = 'vtjmetrics-download-btn'
const VT_ICON_PATH = 'icons/icon16.png'

const VT_METRIC_SELECT_ID = 'vtjmetrics-metric-select'
const VT_ADD_METRIC_ID = 'vtjmetrics-add-metric-btn'
const VT_SELECTED_LIST_ID = 'vtjmetrics-selected-list'
const VT_EDGE_MODE_ID = 'vtjmetrics-edge-mode'
const VT_VIZ_CANVAS_ID = 'vtjmetrics-viz-canvas'
const VT_VIZ_EMPTY_ID = 'vtjmetrics-viz-empty'
const VT_VIZ_WARNINGS_ID = 'vtjmetrics-viz-warnings'
const VT_VIZ_DETAILS_ID = 'vtjmetrics-viz-details'
const VT_VIZ_LEGEND_ID = 'vtjmetrics-viz-legend'
const VT_RESET_HIDDEN_ID = 'vtjmetrics-reset-hidden-btn'
const VT_CONTEXT_MENU_ID = 'vtjmetrics-context-menu'

const EDGE_MODE_LAST = 'last'
const EDGE_MODE_ALL = 'all'
const FAN_OUT_COLOR = '#d73a49'
const FAN_IN_COLOR = '#1f6feb'

const COUPLING_METRICS = [
  { id: 'file-coupling', label: 'File Coupling', level: 'file' },
  { id: 'package-coupling', label: 'Package Coupling', level: 'package' },
  { id: 'cyclic-coupling', label: 'Cyclic Coupling', level: 'file' },
  { id: 'temporal-coupling', label: 'Temporal Coupling', level: 'file' },
  { id: 'class-coupling', label: 'Class Coupling', level: 'class' },
  { id: 'function-coupling', label: 'Function Coupling', level: 'function' }
]

const METRIC_COLOR_BY_ID = {
  'package-coupling': '#93c5fd',
  'file-coupling': '#7dd3fc',
  'cyclic-coupling': '#38bdf8',
  'temporal-coupling': '#1d4ed8',
  'class-coupling': '#38bdf8',
  'function-coupling': '#0284c7'
}

let latestResult = null
let latestRepoContext = null
let previousHref = location.href
let currentRepoKey = null

const vizState = {
  selectedMetricIds: [],
  edgeMode: EDGE_MODE_ALL,
  lineThresholdByMetricId: {},
  hiddenNodeKeys: []
}

let contextMenuNodeData = null
const fileExportCountCache = new Map()
let contextMenuGlobalListenersBound = false

const RESERVED_FIRST_SEGMENTS = new Set([
  'features',
  'topics',
  'collections',
  'trending',
  'events',
  'marketplace',
  'pricing',
  'search',
  'notifications',
  'pulls',
  'issues',
  'codespaces',
  'sponsors',
  'settings',
  'orgs',
  'enterprise',
  'about',
  'contact'
])

function parseRepoContext () {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  if (RESERVED_FIRST_SEGMENTS.has(parts[0])) return null

  const owner = parts[0]
  const repo = parts[1]
  if (!owner || !repo) return null

  let ref = 'HEAD'
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    ref = decodeURIComponent(parts[3])
  }

  return { owner, repo, ref }
}

function getRepoKey (repoContext) {
  return `${repoContext.owner}/${repoContext.repo}`
}

function getRepoNavigation () {
  const selectors = [
    'nav[aria-label="Repository"] .UnderlineNav-body',
    'nav[aria-label="Repository"]',
    '.js-repo-nav .UnderlineNav-body',
    '.js-repo-nav',
    '[data-pjax="#repo-content-pjax-container"] nav',
    '.UnderlineNav-body'
  ]

  for (const selector of selectors) {
    const node = document.querySelector(selector)
    if (node) return node
  }

  return null
}

function findRepoSettingsLink (repoContext) {
  const targetPath = `/${repoContext.owner}/${repoContext.repo}/settings`
  const allAnchors = [...document.querySelectorAll('a[href]')]

  return allAnchors.find((anchor) => {
    try {
      const url = new URL(anchor.href, window.location.origin)
      return url.pathname === targetPath || url.pathname === `${targetPath}/`
    } catch {
      return false
    }
  }) || null
}

function findLastRepoTabLink (repoContext) {
  const nav = getRepoNavigation()

  const repoPrefix = `/${repoContext.owner}/${repoContext.repo}`
  const scopedAnchors = nav ? [...nav.querySelectorAll('a[href]')] : []
  const globalAnchors = [
    ...document.querySelectorAll(
      'nav[aria-label="Repository"] a[href], a.UnderlineNav-item[href], .js-repo-nav a[href]'
    )
  ]

  const anchors = [...new Set([...scopedAnchors, ...globalAnchors])]
    .filter((anchor) => anchor.id !== VT_TAB_ID && anchor.getAttribute('data-vtjmetrics') !== 'true')
    .filter((anchor) => {
      try {
        const url = new URL(anchor.href, window.location.origin)
        return url.pathname.startsWith(repoPrefix)
      } catch {
        return false
      }
    })

  return anchors.length > 0 ? anchors[anchors.length - 1] : null
}

function resolveTabClassName (referenceLink, nav) {
  if (referenceLink?.className) return referenceLink.className
  const firstLink = nav?.querySelector('a[href]')
  return firstLink?.className || ''
}

function createTabLink (className = '') {
  const tab = document.createElement('a')
  tab.id = VT_TAB_ID
  tab.href = '#'
  tab.className = className
  tab.setAttribute('data-vtjmetrics', 'true')

  const icon = document.createElement('img')
  icon.src = chrome.runtime.getURL(VT_ICON_PATH)
  icon.alt = ''
  icon.className = 'vtjmetrics-tab-icon'
  icon.width = 14
  icon.height = 14

  const text = document.createElement('span')
  text.textContent = 'VTJMetrics'

  const wrapper = document.createElement('span')
  wrapper.className = 'vtjmetrics-tab-content'
  wrapper.appendChild(icon)
  wrapper.appendChild(text)
  tab.appendChild(wrapper)

  tab.addEventListener('click', (event) => {
    event.preventDefault()
    openPanel()
  })
  return tab
}

function mountTab () {
  const repoContext = parseRepoContext()
  if (!repoContext) return

  if (document.getElementById(VT_TAB_ID)) return

  const settingsLink = findRepoSettingsLink(repoContext)
  const targetLink = settingsLink || findLastRepoTabLink(repoContext)
  const nav = getRepoNavigation() || targetLink?.closest('nav') || targetLink?.parentElement
  if (!targetLink && !nav) return

  const tab = createTabLink(resolveTabClassName(targetLink, nav))

  if (targetLink?.parentElement && targetLink.parentElement.tagName === 'LI') {
    const wrapper = document.createElement('li')
    wrapper.className = targetLink.parentElement.className
    wrapper.appendChild(tab)
    targetLink.parentElement.insertAdjacentElement('afterend', wrapper)
    return
  }

  if (targetLink) {
    targetLink.insertAdjacentElement('afterend', tab)
    return
  }

  const lastLi = nav.querySelector('li:last-child')
  if (lastLi?.parentElement) {
    const wrapper = document.createElement('li')
    wrapper.className = lastLi.className
    wrapper.appendChild(tab)
    lastLi.insertAdjacentElement('afterend', wrapper)
    return
  }

  nav.appendChild(tab)
}

function findPanelContainer () {
  return document.querySelector('main') || document.body
}

function setStatus (text, type = 'info') {
  const status = document.getElementById(VT_STATUS_ID)
  if (!status) return
  status.textContent = text
  status.dataset.type = type
}

function setCalculateBusy (isBusy) {
  const btn = document.getElementById(VT_CALCULATE_ID)
  const input = document.getElementById(VT_PATH_ID)
  if (!btn || !input) return
  btn.disabled = isBusy
  input.disabled = isBusy
  btn.textContent = isBusy ? 'Calculating...' : 'Calculate metrics'
}

function savePathForRepo (repoContext, sourcePath) {
  const key = `vtjmetrics:path:${getRepoKey(repoContext)}`
  localStorage.setItem(key, sourcePath)
}

function loadPathForRepo (repoContext) {
  const key = `vtjmetrics:path:${getRepoKey(repoContext)}`
  return localStorage.getItem(key) || ''
}

function saveVizPrefsForRepo (repoContext) {
  const key = `vtjmetrics:viz:${getRepoKey(repoContext)}`
  const payload = {
    selectedMetricIds: vizState.selectedMetricIds,
    edgeMode: vizState.edgeMode,
    lineThresholdByMetricId: vizState.lineThresholdByMetricId,
    hiddenNodeKeys: vizState.hiddenNodeKeys
  }
  localStorage.setItem(key, JSON.stringify(payload))
}

function loadVizPrefsForRepo (repoContext) {
  const key = `vtjmetrics:viz:${getRepoKey(repoContext)}`
  const raw = localStorage.getItem(key)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function hasMetricResultData (metricId, result = latestResult) {
  const metric = result?.[metricId]
  if (!metric || !metric.result || typeof metric.result !== 'object') return false
  return Object.keys(metric.result).length > 0
}

function getAvailableCouplingMetrics (result = latestResult) {
  return COUPLING_METRICS.filter(metric => hasMetricResultData(metric.id, result))
}

function getThresholdForMetric (metricId) {
  const raw = vizState.lineThresholdByMetricId?.[metricId]
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function ensureDefaultSelection (repoContext) {
  const available = getAvailableCouplingMetrics()
  vizState.selectedMetricIds = vizState.selectedMetricIds.filter(id => available.some(metric => metric.id === id))
  vizState.hiddenNodeKeys = Array.isArray(vizState.hiddenNodeKeys)
    ? vizState.hiddenNodeKeys.filter(key => typeof key === 'string')
    : []

  if (vizState.selectedMetricIds.length === 0 && available.length > 0) {
    vizState.selectedMetricIds = [available[0].id]
  }

  vizState.lineThresholdByMetricId = vizState.lineThresholdByMetricId && typeof vizState.lineThresholdByMetricId === 'object'
    ? vizState.lineThresholdByMetricId
    : {}

  for (const metric of COUPLING_METRICS) {
    vizState.lineThresholdByMetricId[metric.id] = getThresholdForMetric(metric.id)
  }

  if (![EDGE_MODE_LAST, EDGE_MODE_ALL].includes(vizState.edgeMode)) {
    vizState.edgeMode = EDGE_MODE_ALL
  }

  saveVizPrefsForRepo(repoContext)
}

function applySavedVizPrefs (repoContext) {
  const repoKey = getRepoKey(repoContext)
  if (currentRepoKey === repoKey) return

  currentRepoKey = repoKey
  const saved = loadVizPrefsForRepo(repoContext)

  vizState.selectedMetricIds = Array.isArray(saved?.selectedMetricIds)
    ? saved.selectedMetricIds.filter(v => typeof v === 'string')
    : []

  vizState.edgeMode = saved?.edgeMode === EDGE_MODE_LAST ? EDGE_MODE_LAST : EDGE_MODE_ALL
  vizState.lineThresholdByMetricId = saved?.lineThresholdByMetricId && typeof saved.lineThresholdByMetricId === 'object'
    ? saved.lineThresholdByMetricId
    : {}
  vizState.hiddenNodeKeys = Array.isArray(saved?.hiddenNodeKeys)
    ? saved.hiddenNodeKeys.filter(v => typeof v === 'string')
    : []
}

function downloadLatestResult () {
  if (!latestResult || !latestRepoContext) return
  const filename = `${latestRepoContext.owner}-${latestRepoContext.repo}-vtjmetrics.json`
  const content = JSON.stringify(latestResult, null, 2)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function getGitHubTokenFromStorage () {
  try {
    const stored = await chrome.storage.sync.get(['jtmetricsGitHubToken'])
    return stored?.jtmetricsGitHubToken || ''
  } catch {
    return ''
  }
}

function runMetricsViaBackgroundMessage (payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'JTMETRICS_CALCULATE',
        payload
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'Unknown error'))
          return
        }
        resolve(response.data)
      }
    )
  })
}

async function runMetricsInActiveContext (payload) {
  if (typeof self.runJTMetricsInBrowser === 'function') {
    const githubToken = await getGitHubTokenFromStorage()
    return self.runJTMetricsInBrowser({
      ...payload,
      githubToken
    })
  }

  return runMetricsViaBackgroundMessage(payload)
}

async function calculateMetrics () {
  const repoContext = parseRepoContext()
  if (!repoContext) {
    setStatus('This page is not a repository view.', 'error')
    return
  }

  const input = document.getElementById(VT_PATH_ID)
  const downloadBtn = document.getElementById(VT_DOWNLOAD_ID)
  if (!input || !downloadBtn) return

  const sourcePath = input.value.trim()
  if (!sourcePath) {
    setStatus('Please enter a source path (for example: src).', 'error')
    return
  }

  setCalculateBusy(true)
  setStatus('Running all available metrics...', 'info')
  savePathForRepo(repoContext, sourcePath)

  try {
    const data = await runMetricsInActiveContext({
      owner: repoContext.owner,
      repo: repoContext.repo,
      ref: repoContext.ref,
      sourcePath
    })

    latestResult = data
    latestRepoContext = repoContext
    ensureDefaultSelection(repoContext)
    renderVizControls()
    renderVisualization()

    downloadBtn.hidden = false
    setStatus('Done. You can now download JSON and visualize coupling metrics.', 'success')
  } catch (error) {
    setStatus(`Failed: ${error?.message || 'Unknown error'}`, 'error')
  } finally {
    setCalculateBusy(false)
  }
}

function buildPanelHtml (repoContext) {
  const defaultPath = loadPathForRepo(repoContext) || 'src'
  return `
    <div class="vtjmetrics-card">
      <h2>VTJMetrics <small>v0.4.0</small></h2>
      <p>
        Enter the JavaScript/TypeScript source path inside this repository, run metrics,
        and visualize coupling interactively.
      </p>

      <label for="${VT_PATH_ID}">Source path</label>
      <input id="${VT_PATH_ID}" type="text" value="${defaultPath}" placeholder="src" />

      <div class="vtjmetrics-actions">
        <button id="${VT_CALCULATE_ID}" type="button">Calculate metrics</button>
        <button id="${VT_DOWNLOAD_ID}" type="button" hidden>Download JSON</button>
      </div>

      <p id="${VT_STATUS_ID}" data-type="info">Ready.</p>

      <section class="vtjmetrics-viz-section">
        <div class="vtjmetrics-viz-header">
          <h3>Coupling Visualization</h3>
          <p>
            Add/remove coupling metrics on-the-fly and reorder precedence.
            Outer circles follow earlier precedence; inner circles follow later precedence.
          </p>
        </div>

        <div class="vtjmetrics-viz-controls-grid">
          <div class="vtjmetrics-control-block">
            <label for="${VT_METRIC_SELECT_ID}">Metric to add</label>
            <div class="vtjmetrics-control-inline">
              <select id="${VT_METRIC_SELECT_ID}"></select>
              <button id="${VT_ADD_METRIC_ID}" type="button">Add</button>
            </div>
          </div>

          <div class="vtjmetrics-control-block">
            <label for="${VT_EDGE_MODE_ID}">Coupling display mode</label>
            <select id="${VT_EDGE_MODE_ID}">
              <option value="${EDGE_MODE_ALL}">Show all selected coupling levels (Recommended)</option>
              <option value="${EDGE_MODE_LAST}">Show only last precedence coupling</option>
            </select>
          </div>
        </div>

        <div class="vtjmetrics-control-block">
          <div class="vtjmetrics-precedence-header">
            <label>Precedence (first = outer, last = inner)</label>
            <button id="${VT_RESET_HIDDEN_ID}" type="button" class="vtjmetrics-reset-hidden-btn">Restore hidden elements</button>
          </div>
          <ul id="${VT_SELECTED_LIST_ID}" class="vtjmetrics-selected-list"></ul>
        </div>

        <div id="${VT_VIZ_LEGEND_ID}" class="vtjmetrics-viz-legend"></div>
        <div id="${VT_VIZ_WARNINGS_ID}" class="vtjmetrics-viz-warnings" hidden></div>
        <p id="${VT_VIZ_EMPTY_ID}" class="vtjmetrics-viz-empty">
          Run metrics first, then select at least one coupling metric.
        </p>
        <div id="${VT_VIZ_CANVAS_ID}" class="vtjmetrics-viz-canvas"></div>
        <div id="${VT_VIZ_DETAILS_ID}" class="vtjmetrics-viz-details">
          Hover a circle to inspect details. Drag circles to reposition. Single click opens actions and summary.
        </div>
        <div id="${VT_CONTEXT_MENU_ID}" class="vtjmetrics-context-menu" hidden></div>
      </section>

      <p class="vtjmetrics-note">
        Metrics run directly in your browser. Configure optional GitHub token in extension options.
      </p>
    </div>
  `
}

function truncateMiddle (value, max = 46) {
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

function getClassesPerFileResult () {
  return latestResult?.['classes-per-file']?.result || {}
}

function getFunctionsPerFileResult () {
  return latestResult?.['functions-per-file']?.result || {}
}

function getLinesPerFileResult () {
  return latestResult?.['lines-per-file']?.result || {}
}

function getFunctionLengthResult () {
  return latestResult?.['function-length']?.result || {}
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
  if (start != null && end != null && end >= start) {
    return end - start + 1
  }
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

  const lineCount = toNonNegativeInt(
    functionLengthResult?.[filePath]?.[functionName]?.lines,
    0
  )

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

function getMetricLabel (metricId) {
  return COUPLING_METRICS.find(metric => metric.id === metricId)?.label || metricId
}

function getRepoRelativePath (filePath) {
  if (!filePath) return ''
  if (!latestRepoContext) return filePath.replace(/^\/+/, '')

  const prefix = `/${latestRepoContext.owner}/${latestRepoContext.repo}/`
  if (filePath.startsWith(prefix)) return filePath.slice(prefix.length)

  return filePath.replace(/^\/+/, '')
}

function getPackageIdFromFilePath (filePath) {
  const repoPath = getRepoRelativePath(filePath)
  if (!repoPath) return '.'
  const parts = repoPath.split('/').filter(Boolean)
  if (parts.length <= 1) return '.'
  parts.pop()
  return parts.join('/') || '.'
}

function getPackageLabel (packageId) {
  if (!packageId || packageId === '.') return '(root package)'
  return packageId
}

function encodeRepoPathForUrl (path) {
  return path
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/')
}

function buildBlobUrlForNode (nodeMeta) {
  if (!latestRepoContext || !nodeMeta?.filePath) return null

  const repoPath = getRepoRelativePath(nodeMeta.filePath)
  if (!repoPath) return null

  const ref = encodeURIComponent(latestRepoContext.ref || 'HEAD')
  const line = toNonNegativeInt(nodeMeta.startLine, 1) || 1

  return `https://github.com/${latestRepoContext.owner}/${latestRepoContext.repo}/blob/${ref}/${encodeRepoPathForUrl(repoPath)}#L${line}`
}

function decodeBase64Utf8 (base64) {
  try {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return atob(base64)
  }
}

async function fetchFileSourceFromGitHub (filePath) {
  if (!latestRepoContext) return null

  const repoPath = getRepoRelativePath(filePath)
  if (!repoPath) return null

  const token = await getGitHubTokenFromStorage()
  const url = `https://api.github.com/repos/${latestRepoContext.owner}/${latestRepoContext.repo}/contents/${encodeRepoPathForUrl(repoPath)}?ref=${encodeURIComponent(latestRepoContext.ref || 'HEAD')}`
  const headers = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(url, { headers })
  if (!response.ok) return null

  const payload = await response.json()
  if (!payload?.content || payload.encoding !== 'base64') return null
  return decodeBase64Utf8(payload.content)
}

function countExportStatements (source) {
  if (!source) return 0
  const esModule = (source.match(/\bexport\s+(default|const|let|var|function|class|\{|\*)/g) || []).length
  const commonJs = (source.match(/\bmodule\.exports\b/g) || []).length + (source.match(/\bexports\.[a-zA-Z_$]/g) || []).length
  return esModule + commonJs
}

async function getFileExportCount (filePath) {
  if (!latestRepoContext) return null
  const cacheKey = `${latestRepoContext.owner}/${latestRepoContext.repo}@${latestRepoContext.ref}:${filePath}`
  if (fileExportCountCache.has(cacheKey)) return fileExportCountCache.get(cacheKey)

  const source = await fetchFileSourceFromGitHub(filePath)
  if (source == null) {
    fileExportCountCache.set(cacheKey, null)
    return null
  }

  const count = countExportStatements(source)
  fileExportCountCache.set(cacheKey, count)
  return count
}

function getContextMenuElement () {
  return document.getElementById(VT_CONTEXT_MENU_ID)
}

function closeContextMenu () {
  const menu = getContextMenuElement()
  if (!menu) return
  menu.hidden = true
  menu.innerHTML = ''
  contextMenuNodeData = null
}

function openContextMenuAt (clientX, clientY, nodeData) {
  const menu = getContextMenuElement()
  if (!menu || !nodeData) return

  contextMenuNodeData = nodeData
  menu.innerHTML = `
    <button type="button" data-action="remove-node">Remove from graph</button>
    <button type="button" data-action="goto-source">Go to source line</button>
  `
  menu.hidden = false

  const rect = menu.getBoundingClientRect()
  const menuWidth = rect.width || 220
  const menuHeight = rect.height || 120
  const left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, clientX + 8))
  const top = Math.max(12, Math.min(window.innerHeight - menuHeight - 12, clientY + 8))
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
}

async function renderNodeStatisticsSummary (nodeMeta, metricId) {
  const metricLabel = getMetricLabel(metricId)
  const filePath = nodeMeta?.filePath
  if (!filePath) return

  const fileLineInfo = getFileLineInfo(filePath)
  const classesCount = Object.keys(getClassesPerFileResult()?.[filePath] || {}).length
  const functionsCount = Object.keys(getFunctionsPerFileResult()?.[filePath] || {}).length
  const exportsCount = await getFileExportCount(filePath)

  let extra = ''
  if (metricId === 'class-coupling') {
    extra = `<span>Class: <strong>${nodeMeta.className || nodeMeta.label || 'N/A'}</strong> | Class lines: <strong>${nodeMeta.lines ?? 0}</strong></span><br>`
  } else if (metricId === 'function-coupling') {
    extra = `<span>Function: <strong>${nodeMeta.functionName || nodeMeta.label || 'N/A'}</strong> | Function lines: <strong>${nodeMeta.lines ?? 0}</strong></span><br>`
  }

  updateDetails(`
    <strong>${metricLabel} Summary</strong><br>
    <span>${truncateMiddle(nodeMeta.fullLabel || nodeMeta.label || '', 100)}</span><br>
    ${extra}
    <span>File lines: <strong>${fileLineInfo.lines}</strong> | Classes: <strong>${classesCount}</strong> | Functions: <strong>${functionsCount}</strong> | Exports: <strong>${exportsCount == null ? 'N/A' : exportsCount}</strong></span><br>
    <span>Fan-In: <strong>${nodeMeta.fanIn ?? 0}</strong> | Fan-Out: <strong>${nodeMeta.fanOut ?? 0}</strong> | Coupling score: <strong>${nodeMeta.value ?? 0}</strong></span>
  `)
}

function buildClassNameToEntityMap (result) {
  const map = new Map()

  for (const [filePath, classes] of Object.entries(result || {})) {
    if (!classes || typeof classes !== 'object') continue

    for (const className of Object.keys(classes)) {
      if (!map.has(className)) {
        map.set(className, `${filePath}::${className}`)
      }
    }
  }

  return map
}

function buildFunctionNameToEntityMap (result) {
  const map = new Map()

  for (const [filePath, functions] of Object.entries(result || {})) {
    if (!functions || typeof functions !== 'object') continue

    for (const functionName of Object.keys(functions)) {
      if (!map.has(functionName)) {
        map.set(functionName, `${filePath}::${functionName}`)
      }
    }
  }

  return map
}

function buildFunctionClassMap () {
  const output = {}
  const raw = latestResult?.['classes-per-file']?.result
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
  const result = latestResult?.['file-coupling']?.result || {}
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
      packageId: getPackageIdFromFilePath(filePath),
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

  return {
    metricId: 'file-coupling',
    level: 'file',
    nodes,
    links,
    warnings: []
  }
}

function extractClassCouplingGraph () {
  const result = latestResult?.['class-coupling']?.result || {}
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
        packageId: getPackageIdFromFilePath(filePath),
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

  return {
    metricId: 'class-coupling',
    level: 'class',
    nodes,
    links,
    warnings
  }
}

function extractFunctionCouplingGraph () {
  const result = latestResult?.['function-coupling']?.result || {}
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
        packageId: getPackageIdFromFilePath(filePath),
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

  return {
    metricId: 'function-coupling',
    level: 'function',
    nodes,
    links,
    warnings
  }
}

function extractPackageCouplingGraph () {
  const result = latestResult?.['package-coupling']?.result || {}
  const nodes = []
  const links = []

  for (const [packageId, coupling] of Object.entries(result)) {
    const fanIn = toArrayUniqueStrings(coupling?.fanIn)
    const fanOut = toArrayUniqueStrings(coupling?.fanOut)
    const weightMap = coupling?.weights && typeof coupling.weights === 'object' ? coupling.weights : {}

    nodes.push({
      metricId: 'package-coupling',
      entityId: packageId,
      packageId,
      label: getPackageLabel(packageId),
      fullLabel: `Package ${getPackageLabel(packageId)}`,
      value: Math.max(1, fanIn.length + fanOut.length),
      fanIn: fanIn.length,
      fanOut: fanOut.length,
      lines: toNonNegativeInt(coupling?.lines, 0),
      files: toNonNegativeInt(coupling?.files, 0),
      instability: typeof coupling?.instability === 'number' ? coupling.instability : 0
    })

    for (const targetPackage of fanOut) {
      links.push({
        metricId: 'package-coupling',
        sourceEntity: packageId,
        targetEntity: targetPackage,
        weight: Math.max(1, toNonNegativeInt(weightMap[targetPackage], 1))
      })
    }
  }

  return {
    metricId: 'package-coupling',
    level: 'package',
    nodes,
    links,
    warnings: []
  }
}

function extractCyclicCouplingGraph () {
  const result = latestResult?.['cyclic-coupling']?.result || {}
  const nodes = []
  const links = []
  const cycleSizes = []

  for (const [filePath, coupling] of Object.entries(result)) {
    const fanIn = toArrayUniqueStrings(coupling?.fanIn)
    const fanOut = toArrayUniqueStrings(coupling?.fanOut)
    const lineInfo = getFileLineInfo(filePath)
    const cycleSize = toNonNegativeInt(coupling?.cycleSize, 1)
    cycleSizes.push(cycleSize)

    nodes.push({
      metricId: 'cyclic-coupling',
      entityId: filePath,
      filePath,
      packageId: getPackageIdFromFilePath(filePath),
      label: shortPathLabel(filePath),
      fullLabel: `${filePath} (${coupling?.cycleId || 'cycle'})`,
      value: Math.max(1, fanIn.length + fanOut.length),
      fanIn: fanIn.length,
      fanOut: fanOut.length,
      cycleId: coupling?.cycleId || null,
      cycleSize,
      lines: lineInfo.lines,
      startLine: 1
    })

    for (const target of fanOut) {
      links.push({
        metricId: 'cyclic-coupling',
        sourceEntity: filePath,
        targetEntity: target,
        weight: Math.max(1, cycleSize)
      })
    }
  }

  const uniqueCycles = new Set(nodes.map(node => node.cycleId).filter(Boolean))
  const warnings = []
  if (nodes.length === 0) warnings.push('Cyclic-coupling: no dependency cycles detected in the selected source path.')
  if (uniqueCycles.size > 0) warnings.push(`Cyclic-coupling: detected ${uniqueCycles.size} cycle(s), max cycle size ${Math.max(1, ...cycleSizes)}.`)

  return {
    metricId: 'cyclic-coupling',
    level: 'file',
    nodes,
    links,
    warnings
  }
}

function extractTemporalCouplingGraph () {
  const result = latestResult?.['temporal-coupling']?.result || {}
  const nodes = []
  const links = []

  for (const [filePath, coupling] of Object.entries(result)) {
    const fanIn = toArrayUniqueStrings(coupling?.fanIn)
    const fanOut = toArrayUniqueStrings(coupling?.fanOut)
    const weightMap = coupling?.weights && typeof coupling.weights === 'object' ? coupling.weights : {}
    const lineInfo = getFileLineInfo(filePath)

    nodes.push({
      metricId: 'temporal-coupling',
      entityId: filePath,
      filePath,
      packageId: getPackageIdFromFilePath(filePath),
      label: shortPathLabel(filePath),
      fullLabel: filePath,
      value: Math.max(1, fanIn.length + fanOut.length),
      fanIn: fanIn.length,
      fanOut: fanOut.length,
      temporalIn: toNonNegativeInt(coupling?.temporalIn, 0),
      temporalOut: toNonNegativeInt(coupling?.temporalOut, 0),
      lines: lineInfo.lines,
      startLine: 1
    })

    for (const target of fanOut) {
      links.push({
        metricId: 'temporal-coupling',
        sourceEntity: filePath,
        targetEntity: target,
        weight: Math.max(1, toNonNegativeInt(weightMap[target], 1))
      })
    }
  }

  const warnings = []
  const temporalSamples = toNonNegativeInt(latestResult?._meta?.temporalCommits, 0)
  if (nodes.length === 0) {
    if (temporalSamples > 0) {
      warnings.push('Temporal-coupling: recent commits were analyzed, but no co-change links were found for files in this source path.')
    } else {
      warnings.push('Temporal-coupling: unavailable (no commit history analyzed for current context).')
    }
  } else if (temporalSamples > 0) {
    warnings.push(`Temporal-coupling: built from ${temporalSamples} recent commit(s).`)
  }

  return {
    metricId: 'temporal-coupling',
    level: 'file',
    nodes,
    links,
    warnings
  }
}

function buildGraphByMetricId (metricId) {
  if (metricId === 'package-coupling') return extractPackageCouplingGraph()
  if (metricId === 'file-coupling') return extractFileCouplingGraph()
  if (metricId === 'cyclic-coupling') return extractCyclicCouplingGraph()
  if (metricId === 'temporal-coupling') return extractTemporalCouplingGraph()
  if (metricId === 'class-coupling') return extractClassCouplingGraph()
  if (metricId === 'function-coupling') return extractFunctionCouplingGraph()
  return null
}

function resolveParentEntityId (childNode, childLevel, parentLevel) {
  if (!parentLevel) return null

  if (childLevel === 'package' && parentLevel === 'package') {
    return childNode.packageId || null
  }

  if (childLevel === 'file' && parentLevel === 'package') {
    return childNode.packageId || getPackageIdFromFilePath(childNode.filePath)
  }

  if (childLevel === 'file' && parentLevel === 'file') {
    return childNode.filePath || null
  }

  if (childLevel === 'class' && parentLevel === 'file') {
    return childNode.filePath
  }

  if (childLevel === 'class' && parentLevel === 'package') {
    return childNode.packageId || getPackageIdFromFilePath(childNode.filePath)
  }

  if (childLevel === 'function' && parentLevel === 'class') {
    return childNode.classEntityId || null
  }

  if (childLevel === 'function' && parentLevel === 'file') {
    return childNode.filePath
  }

  if (childLevel === 'function' && parentLevel === 'package') {
    return childNode.packageId || getPackageIdFromFilePath(childNode.filePath)
  }

  return null
}

function buildVisualizationModel (selectedMetricIds, edgeMode) {
  const graphList = []
  const warnings = []
  const hiddenNodeKeys = new Set(vizState.hiddenNodeKeys || [])

  for (const metricId of selectedMetricIds) {
    const graph = buildGraphByMetricId(metricId)
    if (!graph) continue

    const threshold = getThresholdForMetric(metricId)
    const filteredNodes = graph.nodes.filter((node) => {
      const key = `${metricId}|${node.entityId}`
      const lines = toNonNegativeInt(node.lines, 0)
      return !hiddenNodeKeys.has(key) && lines >= threshold
    })
    const entitySet = new Set(filteredNodes.map(node => node.entityId))
    const filteredLinks = graph.links.filter(link =>
      entitySet.has(link.sourceEntity) && entitySet.has(link.targetEntity)
    )

    if (graph.nodes.length > 0 && filteredNodes.length === 0) {
      warnings.push(`${getMetricLabel(metricId)}: no elements match min lines >= ${threshold}`)
    }

    graphList.push({
      ...graph,
      nodes: filteredNodes,
      links: filteredLinks,
      threshold
    })
    warnings.push(...graph.warnings)
  }

  const root = {
    key: 'root',
    label: 'Repository',
    value: 1,
    children: []
  }

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
        if (candidateKey && treeByKey.has(candidateKey)) {
          parentKey = candidateKey
        }
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

      links.push({
        ...link,
        sourceKey,
        targetKey
      })
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
  const warningsNode = document.getElementById(VT_VIZ_WARNINGS_ID)
  if (!warningsNode) return

  if (!warnings || warnings.length === 0) {
    warningsNode.hidden = true
    warningsNode.textContent = ''
    return
  }

  warningsNode.hidden = false
  warningsNode.textContent = `Notes: ${warnings.join(' | ')}`
}

function renderLegend (graphList) {
  const legendNode = document.getElementById(VT_VIZ_LEGEND_ID)
  if (!legendNode) return

  if (!graphList || graphList.length === 0) {
    legendNode.innerHTML = ''
    return
  }

  const flowLegend = `
    <span class="vtjmetrics-legend-chip vtjmetrics-legend-flow">
      <span class="vtjmetrics-legend-line" style="background:${FAN_OUT_COLOR}"></span>
      Fan-Out
    </span>
    <span class="vtjmetrics-legend-chip vtjmetrics-legend-flow">
      <span class="vtjmetrics-legend-line" style="background:${FAN_IN_COLOR}"></span>
      Fan-In
    </span>
  `

  const chips = graphList.map((graph, index) => {
    const color = METRIC_COLOR_BY_ID[graph.metricId] || '#57606a'
    const label = getMetricLabel(graph.metricId)
    return `
      <span class="vtjmetrics-legend-chip">
        <span class="vtjmetrics-legend-swatch" style="background:${color}"></span>
        ${index + 1}. ${label} (min lines: ${graph.threshold || 0})
      </span>
    `
  }).join('')

  legendNode.innerHTML = flowLegend + chips
}

function updateDetails (html) {
  const details = document.getElementById(VT_VIZ_DETAILS_ID)
  if (!details) return
  details.innerHTML = html
}

function getSvgSize (container) {
  const width = Math.max(760, Math.min(1200, Math.floor(container.clientWidth || 900)))
  const height = Math.max(480, Math.floor(width * 0.62))
  return { width, height }
}

function renderVisualization () {
  const canvas = document.getElementById(VT_VIZ_CANVAS_ID)
  const emptyMessage = document.getElementById(VT_VIZ_EMPTY_ID)
  if (!canvas || !emptyMessage) return

  closeContextMenu()
  canvas.innerHTML = ''

  if (!latestResult) {
    emptyMessage.hidden = false
    emptyMessage.textContent = 'Run metrics first, then choose one or more coupling metrics.'
    renderLegend([])
    renderWarnings([])
    updateDetails('Run metrics first. Then hover, drag, or double click circles for details/actions.')
    return
  }

  const availableIds = getAvailableCouplingMetrics().map(metric => metric.id)
  const selectedIds = vizState.selectedMetricIds.filter(id => availableIds.includes(id))

  if (selectedIds.length === 0) {
    emptyMessage.hidden = false
    emptyMessage.textContent = 'Select at least one available coupling metric to render.'
    renderLegend([])
    renderWarnings([])
    updateDetails('Select at least one coupling metric to enable interactions.')
    return
  }

  const model = buildVisualizationModel(selectedIds, vizState.edgeMode)

  if (model.graphList.length === 0 || model.hierarchy.children.length === 0) {
    emptyMessage.hidden = false
    emptyMessage.textContent = 'No coupling data found for the selected metrics in this source path.'
    renderLegend([])
    renderWarnings(model.warnings)
    updateDetails('No elements match current filters. Lower min lines or restore hidden elements.')
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
    .attr('role', 'img')
    .attr('aria-label', 'VTJMetrics coupling visualization')

  const root = d3.hierarchy(model.hierarchy)
    .sum(d => Math.max(1, d.value || 1))

  d3.pack()
    .size([width - 16, height - 16])
    .padding(12)(root)

  root.each(node => {
    node.x += 8
    node.y += 8
  })

  const nodeByKey = new Map()
  const circles = root.descendants().filter(node => node.data.key !== 'root')

  for (const node of circles) {
    nodeByKey.set(node.data.key, node)
  }

  const resolvedLinks = model.links
    .map(link => ({
      ...link,
      sourceNode: nodeByKey.get(link.sourceKey),
      targetNode: nodeByKey.get(link.targetKey)
    }))
    .filter(link => link.sourceNode && link.targetNode)

  const proportionalLinks = resolvedLinks.map((link) => {
    const edgeWeight = Math.max(0, link.weight || 0)
    const sourceOut = Math.max(0, toNonNegativeInt(link.sourceNode?.data?.meta?.fanOut, 0))
    const sourceIn = Math.max(0, toNonNegativeInt(link.sourceNode?.data?.meta?.fanIn, 0))
    const totalNodeFlow = sourceOut + sourceIn
    return {
      ...link,
      edgeWeight,
      outFlow: sourceOut,
      inFlow: sourceIn,
      totalNodeFlow
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
  const linkSelection = linksGroup
    .selectAll('g')
    .data(proportionalLinks)
    .enter()
    .append('g')
    .attr('class', 'vtjmetrics-link-group')

  const fanOutSelection = linkSelection
    .append('line')
    .attr('class', 'vtjmetrics-link vtjmetrics-link-out')
    .attr('stroke', FAN_OUT_COLOR)
    .attr('stroke-width', d => d.outWidth)
    .attr('marker-end', `url(#${outArrowId})`)
    .attr('stroke-linecap', 'round')
    .attr('stroke-opacity', 0.9)
    .style('display', d => d.outFlow > 0 ? null : 'none')

  const fanInSelection = linkSelection
    .append('line')
    .attr('class', 'vtjmetrics-link vtjmetrics-link-in')
    .attr('stroke', FAN_IN_COLOR)
    .attr('stroke-width', d => d.inWidth)
    .attr('marker-end', `url(#${inArrowId})`)
    .attr('stroke-linecap', 'round')
    .attr('stroke-opacity', 0.9)
    .style('display', d => d.inFlow > 0 ? null : 'none')

  linkSelection.append('title').text(d => {
    const label = getMetricLabel(d.metricId)
    return `${label}: ${truncateMiddle(d.sourceNode.data.label, 24)} -> ${truncateMiddle(d.targetNode.data.label, 24)} | lineWeight=${d.edgeWeight}, fanOut=${d.outFlow}, fanIn=${d.inFlow}, N=${Math.max(1, d.totalNodeFlow)}`
  })

  function formatPercent (value) {
    return `${(value * 100).toFixed(1)}%`
  }

  linkSelection
    .on('mouseenter', (_event, d) => {
      const N = Math.max(1, d.totalNodeFlow)
      const outPct = d.outFlow > 0 ? (d.outFlow / N) : 0
      const inPct = d.inFlow > 0 ? (d.inFlow / N) : 0
      const label = getMetricLabel(d.metricId)

      fanOutSelection.attr('stroke-opacity', link => link === d ? 0.96 : 0.18)
      fanInSelection.attr('stroke-opacity', link => link === d ? 0.96 : 0.18)

      updateDetails(`
        <strong>${label} - Line formula</strong><br>
        <span>${truncateMiddle(d.sourceNode.data.meta?.fullLabel || d.sourceNode.data.label || '', 70)} → ${truncateMiddle(d.targetNode.data.meta?.fullLabel || d.targetNode.data.label || '', 70)}</span><br>
        <span>N = fanOut + fanIn = <strong>${d.outFlow}</strong> + <strong>${d.inFlow}</strong> = <strong>${N}</strong></span><br>
        <span style="color:${FAN_OUT_COLOR}">fan-out width = (${d.outFlow}/${N}) × max = ${formatPercent(outPct)}</span><br>
        <span style="color:${FAN_IN_COLOR}">fan-in width = (${d.inFlow}/${N}) × max = ${formatPercent(inPct)}</span><br>
        <span>Edge weight (coupling) used for max thickness scale: <strong>${d.edgeWeight}</strong></span>
      `)
    })
    .on('mouseleave', () => {
      fanOutSelection.attr('stroke-opacity', 0.9)
      fanInSelection.attr('stroke-opacity', 0.9)
      updateDetails('Hover a circle to inspect details. Drag circles to reposition. Single click opens actions and summary.')
    })

  function updateLinkGeometry () {
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

  const circlesGroup = svg.append('g').attr('class', 'vtjmetrics-circles')

  const nodeSelection = circlesGroup
    .selectAll('g')
    .data(circles)
    .enter()
    .append('g')
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
    if (node.children && node.children.length > 0) {
      strength = Math.max(0.12, strength * 0.78)
    }
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

  nodeSelection.append('title').text(d => d.data.meta?.fullLabel || d.data.label)

  let dragMoved = false
  const dragBehavior = d3.drag()
    .on('start', function (_event, d) {
      dragMoved = false
      d3.select(this).raise()
      closeContextMenu()
      updateDetails(`Dragging: <strong>${truncateMiddle(d.data.meta?.fullLabel || d.data.label, 90)}</strong>`)
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
            return {
              x: parent.x + dx * ratio,
              y: parent.y + dy * ratio
            }
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
    .on('end', (_event, d) => {
      d.__dragMoved = dragMoved
      setTimeout(() => { d.__dragMoved = false }, 0)
      updateDetails('Hover a circle to inspect details. Drag circles to reposition. Single click opens actions and summary.')
    })

  nodeSelection.call(dragBehavior)

  nodeSelection
    .on('mouseenter', (_event, d) => {
      const metric = COUPLING_METRICS.find(item => item.id === d.data.metricId)
      const metricLabel = metric?.label || d.data.metricId
      const nodeMeta = d.data.meta || {}

      const connectedKeys = new Set([d.data.key])
      for (const link of proportionalLinks) {
        if (link.sourceKey === d.data.key || link.targetKey === d.data.key) {
          connectedKeys.add(link.sourceKey)
          connectedKeys.add(link.targetKey)
        }
      }

      nodeSelection.select('circle')
        .attr('opacity', node => connectedKeys.has(node.data.key) ? 1 : 0.25)

      fanOutSelection
        .attr('stroke-opacity', link => {
          if (link.outFlow <= 0) return 0
          if (link.sourceKey === d.data.key) return 0.95
          if (link.targetKey === d.data.key) return 0.55
          return connectedKeys.has(link.sourceKey) || connectedKeys.has(link.targetKey) ? 0.25 : 0.08
        })

      fanInSelection
        .attr('stroke-opacity', link => {
          if (link.inFlow <= 0) return 0
          if (link.targetKey === d.data.key) return 0.95
          if (link.sourceKey === d.data.key) return 0.55
          return connectedKeys.has(link.sourceKey) || connectedKeys.has(link.targetKey) ? 0.25 : 0.08
        })

      updateDetails(`
        <strong>${metricLabel}</strong><br>
        <span>${truncateMiddle(nodeMeta.fullLabel || d.data.label, 90)}</span><br>
        <span>Lines: <strong>${nodeMeta.lines ?? 0}</strong> | Start line: <strong>${nodeMeta.startLine ?? 1}</strong></span><br>
        <span>Fan-In: <strong>${nodeMeta.fanIn ?? 0}</strong> | Fan-Out: <strong>${nodeMeta.fanOut ?? 0}</strong></span><br>
        <span>Coupling score: <strong>${nodeMeta.value ?? 1}</strong></span><br>
        <span class="vtjmetrics-hint-inline">Single click opens context actions and auto summary.</span>
      `)
    })
    .on('mouseleave', () => {
      nodeSelection.select('circle').attr('opacity', 1)
      fanOutSelection.attr('stroke-opacity', 0.72)
      fanInSelection.attr('stroke-opacity', 0.68)
      updateDetails('Hover a circle to inspect details. Drag circles to reposition. Single click opens actions and summary.')
    })
    .on('click', async (event, d) => {
      if (d.__dragMoved) return
      event.preventDefault()
      event.stopPropagation()
      const nodeData = {
        ...d.data.meta,
        metricId: d.data.metricId,
        entityId: d.data.entityId,
        key: d.data.key,
        label: d.data.label
      }
      openContextMenuAt(event.clientX, event.clientY, nodeData)
      await renderNodeStatisticsSummary(nodeData, nodeData.metricId)
    })
}

function moveMetric (fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= vizState.selectedMetricIds.length) return
  const copy = [...vizState.selectedMetricIds]
  const [item] = copy.splice(fromIndex, 1)
  copy.splice(toIndex, 0, item)
  vizState.selectedMetricIds = copy
}

function getHiddenCountForMetric (metricId) {
  return (vizState.hiddenNodeKeys || []).filter(key => key.startsWith(`${metricId}|`)).length
}

function renderSelectedMetricList () {
  const listNode = document.getElementById(VT_SELECTED_LIST_ID)
  if (!listNode) return

  listNode.innerHTML = ''

  if (vizState.selectedMetricIds.length === 0) {
    const item = document.createElement('li')
    item.className = 'vtjmetrics-selected-empty'
    item.textContent = 'No metrics selected yet.'
    listNode.appendChild(item)
    return
  }

  vizState.selectedMetricIds.forEach((metricId, index) => {
    const metric = COUPLING_METRICS.find(item => item.id === metricId)
    const item = document.createElement('li')
    item.className = 'vtjmetrics-selected-item'

    const color = METRIC_COLOR_BY_ID[metricId] || '#57606a'
    const threshold = getThresholdForMetric(metricId)
    const hiddenCount = getHiddenCountForMetric(metricId)

    item.innerHTML = `
      <div class="vtjmetrics-selected-main">
        <span class="vtjmetrics-selected-index">${index + 1}</span>
        <span class="vtjmetrics-selected-dot" style="background:${color}"></span>
        <span class="vtjmetrics-selected-label">${metric?.label || metricId}</span>
      </div>
      <div class="vtjmetrics-threshold-inline">
        <label class="vtjmetrics-threshold-label">Min lines</label>
        <input
          class="vtjmetrics-threshold-input"
          type="number"
          min="0"
          step="1"
          value="${threshold}"
          data-action="threshold"
          data-metric-id="${metricId}"
        />
        <span class="vtjmetrics-hidden-count">Hidden: ${hiddenCount}</span>
      </div>
      <div class="vtjmetrics-selected-actions">
        <button type="button" data-action="up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>Up</button>
        <button type="button" data-action="down" data-index="${index}" ${index === vizState.selectedMetricIds.length - 1 ? 'disabled' : ''}>Down</button>
        <button type="button" data-action="remove" data-index="${index}">Remove</button>
      </div>
    `

    listNode.appendChild(item)
  })
}

function renderMetricSelectOptions () {
  const select = document.getElementById(VT_METRIC_SELECT_ID)
  const addButton = document.getElementById(VT_ADD_METRIC_ID)
  if (!select || !addButton) return

  const selectable = COUPLING_METRICS.filter(metric => !vizState.selectedMetricIds.includes(metric.id))

  select.innerHTML = ''

  if (selectable.length === 0) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = 'All coupling metrics are already selected'
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

function renderVizControls () {
  renderSelectedMetricList()
  renderMetricSelectOptions()

  const edgeMode = document.getElementById(VT_EDGE_MODE_ID)
  if (edgeMode) {
    edgeMode.value = vizState.edgeMode
  }

  const resetHiddenButton = document.getElementById(VT_RESET_HIDDEN_ID)
  if (resetHiddenButton) {
    resetHiddenButton.disabled = (vizState.hiddenNodeKeys || []).length === 0
  }
}

function bindVizEvents (repoContext) {
  const addMetricButton = document.getElementById(VT_ADD_METRIC_ID)
  const metricSelect = document.getElementById(VT_METRIC_SELECT_ID)
  const selectedList = document.getElementById(VT_SELECTED_LIST_ID)
  const edgeModeSelect = document.getElementById(VT_EDGE_MODE_ID)
  const resetHiddenButton = document.getElementById(VT_RESET_HIDDEN_ID)
  const contextMenu = getContextMenuElement()

  addMetricButton?.addEventListener('click', () => {
    const metricId = metricSelect?.value
    if (!metricId) return

    if (!vizState.selectedMetricIds.includes(metricId)) {
      vizState.selectedMetricIds.push(metricId)
      vizState.lineThresholdByMetricId[metricId] = getThresholdForMetric(metricId)
      saveVizPrefsForRepo(repoContext)
      renderVizControls()
      renderVisualization()
    }
  })

  selectedList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]')
    if (!button) return

    const action = button.dataset.action
    const index = Number(button.dataset.index)
    if (Number.isNaN(index)) return

    if (action === 'up') {
      moveMetric(index, index - 1)
    } else if (action === 'down') {
      moveMetric(index, index + 1)
    } else if (action === 'remove') {
      const removedMetricId = vizState.selectedMetricIds[index]
      vizState.selectedMetricIds.splice(index, 1)
      if (removedMetricId) {
        vizState.hiddenNodeKeys = (vizState.hiddenNodeKeys || []).filter(key => !key.startsWith(`${removedMetricId}|`))
      }
    }

    saveVizPrefsForRepo(repoContext)
    renderVizControls()
    renderVisualization()
  })

  selectedList?.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-action="threshold"]')
    if (!input) return
    const metricId = input.dataset.metricId
    if (!metricId) return

    vizState.lineThresholdByMetricId[metricId] = toNonNegativeInt(input.value, 0)
    saveVizPrefsForRepo(repoContext)
    renderVisualization()
  })

  edgeModeSelect?.addEventListener('change', () => {
    vizState.edgeMode = edgeModeSelect.value === EDGE_MODE_LAST ? EDGE_MODE_LAST : EDGE_MODE_ALL
    saveVizPrefsForRepo(repoContext)
    renderVisualization()
  })

  resetHiddenButton?.addEventListener('click', () => {
    vizState.hiddenNodeKeys = []
    saveVizPrefsForRepo(repoContext)
    renderVizControls()
    renderVisualization()
  })

  contextMenu?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]')
    if (!button || !contextMenuNodeData) return

    const action = button.dataset.action
    if (!action) return

    if (action === 'remove-node') {
      const key = contextMenuNodeData.key
      if (key && !vizState.hiddenNodeKeys.includes(key)) {
        vizState.hiddenNodeKeys.push(key)
      }
      saveVizPrefsForRepo(repoContext)
      closeContextMenu()
      renderVizControls()
      renderVisualization()
      return
    }

    if (action === 'goto-source') {
      const url = buildBlobUrlForNode(contextMenuNodeData)
      if (url) window.open(url, '_blank', 'noopener')
      closeContextMenu()
      return
    }

  })

  if (!contextMenuGlobalListenersBound) {
    document.addEventListener('click', (event) => {
      const menu = getContextMenuElement()
      if (!menu || menu.hidden) return
      const target = event.target
      if (target instanceof Node && menu.contains(target)) return
      closeContextMenu()
    })

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeContextMenu()
    })

    contextMenuGlobalListenersBound = true
  }
}

function openPanel () {
  const repoContext = parseRepoContext()
  if (!repoContext) return

  closeContextMenu()
  applySavedVizPrefs(repoContext)

  const container = findPanelContainer()
  if (!container) return

  let panel = document.getElementById(VT_PANEL_ID)
  if (!panel) {
    panel = document.createElement('section')
    panel.id = VT_PANEL_ID
    panel.className = 'vtjmetrics-panel'
    container.prepend(panel)
  }

  panel.innerHTML = buildPanelHtml(repoContext)
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const calculateBtn = document.getElementById(VT_CALCULATE_ID)
  const downloadBtn = document.getElementById(VT_DOWNLOAD_ID)

  calculateBtn?.addEventListener('click', calculateMetrics)
  downloadBtn?.addEventListener('click', downloadLatestResult)

  bindVizEvents(repoContext)

  if (latestResult) {
    ensureDefaultSelection(repoContext)
    downloadBtn.hidden = false
  }

  renderVizControls()
  renderVisualization()
}

function removePanelAndTabIfNeeded () {
  if (parseRepoContext()) return
  closeContextMenu()
  document.getElementById(VT_TAB_ID)?.remove()
  document.getElementById(VT_PANEL_ID)?.remove()
}

function bootstrap () {
  const repoContext = parseRepoContext()
  if (repoContext) {
    mountTab()
  } else {
    removePanelAndTabIfNeeded()
  }
}

const observer = new MutationObserver(() => {
  if (location.href !== previousHref) {
    previousHref = location.href
    latestResult = null
    latestRepoContext = null
  }
  bootstrap()
})

observer.observe(document.documentElement, { subtree: true, childList: true })
bootstrap()
