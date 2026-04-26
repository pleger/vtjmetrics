(function () {
  const SUPPORTED_EXTENSIONS = new Set(['.js', '.cjs', '.ts'])
  const IMPORT_RESOLUTION_EXTENSIONS = ['.js', '.cjs', '.ts', '.jsx', '.tsx', '.json']

  const METRIC_FILES = {
    files: 'files.metric.js',
    'package-coupling': 'packageCoupling.metric.js',
    'lines-per-file': 'linesPerFile.metric.js',
    'functions-per-file': 'functionsPerFile.metric.js',
    'function-length': 'functionLength.metric.js',
    'parameter-count': 'parameterCount.metric.js',
    'function-coupling': 'functionCoupling.metric.js',
    'function-dependency-summary': 'functionDependencySummary.metric.js',
    'classes-per-file': 'classesPerFile.metric.js',
    'class-coupling': 'classCoupling.metric.js',
    'class-dependency-summary': 'classDependencySummary.metric.js',
    'file-coupling': 'fileCoupling.metric.js',
    'cyclic-coupling': 'cyclicCoupling.metric.js',
    'temporal-coupling': 'temporalCoupling.metric.js',
    'import-instability': 'importInstability.metric.js',
    'dependency-centrality': 'dependencyCentrality.metric.js',
    'instance-mapper': 'instanceMapper.metric.js'
  }

  const METRIC_IDS = Object.keys(METRIC_FILES)

  const PARSER_OPTIONS = {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx']
  }

  const CACHE_TTL_MS = 5 * 60 * 1000
  const CACHE_LIMITS = {
    defaultBranch: 128,
    tree: 128,
    blob: 1024,
    commitList: 128,
    commitDetail: 1024
  }

  const requestCache = {
    defaultBranch: new Map(),
    tree: new Map(),
    blob: new Map(),
    commitList: new Map(),
    commitDetail: new Map()
  }

  function getCachedValue (cacheMap, key) {
    const entry = cacheMap.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      cacheMap.delete(key)
      return null
    }
    return entry.value
  }

  function setCachedValue (cacheMap, key, value, maxEntries) {
    if (cacheMap.has(key)) cacheMap.delete(key)
    cacheMap.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS
    })

    while (cacheMap.size > maxEntries) {
      const oldestKey = cacheMap.keys().next().value
      if (typeof oldestKey === 'undefined') break
      cacheMap.delete(oldestKey)
    }
  }

  function deepClone (value) {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value))
  }

  function createLogger () {
    const state = {
      fileErrors: [],
      parseErrors: [],
      metricErrors: [],
      traverseErrors: []
    }

    return {
      logFileError: msg => state.fileErrors.push(msg),
      logParseError: msg => state.parseErrors.push(msg),
      logMetricError: msg => state.metricErrors.push(msg),
      logTraverseError: msg => state.traverseErrors.push(msg),
      getFileErrors: () => [...state.fileErrors],
      getParseErrors: () => [...state.parseErrors],
      getMetricErrors: () => [...state.metricErrors],
      getTraverseErrors: () => [...state.traverseErrors]
    }
  }

  function extname (filePath) {
    const fileIndex = filePath.lastIndexOf('/')
    const dotIndex = filePath.lastIndexOf('.')
    if (dotIndex <= fileIndex) return ''
    return filePath.slice(dotIndex).toLowerCase()
  }

  function normalizePath (inputPath) {
    const isAbsolute = inputPath.startsWith('/')
    const parts = inputPath.split('/')
    const stack = []

    for (const part of parts) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (stack.length > 0) stack.pop()
        continue
      }
      stack.push(part)
    }

    return `${isAbsolute ? '/' : ''}${stack.join('/')}`
  }

  function dirname (inputPath) {
    const normalized = normalizePath(inputPath)
    const index = normalized.lastIndexOf('/')
    if (index <= 0) return '/'
    return normalized.slice(0, index)
  }

  function joinPath (...parts) {
    return normalizePath(parts.join('/'))
  }

  function sanitizeSourcePath (sourcePath) {
    const trimmed = (sourcePath || '').trim()
    if (!trimmed || trimmed === '.') return '.'
    return trimmed.replace(/^\/+/, '').replace(/\/+$/, '')
  }

  function isPathInsideSourcePath (repoPath, sourcePath) {
    if (sourcePath === '.') return true
    return repoPath === sourcePath || repoPath.startsWith(`${sourcePath}/`)
  }

  function decodeBase64Utf8 (base64String) {
    const binary = atob(base64String.replace(/\n/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }

  async function mapLimit (items, limit, mapper) {
    const results = new Array(items.length)
    let cursor = 0

    async function worker () {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await mapper(items[index], index)
      }
    }

    const workers = []
    const workerCount = Math.max(1, Math.min(limit, items.length))
    for (let i = 0; i < workerCount; i++) workers.push(worker())
    await Promise.all(workers)
    return results
  }

  async function fetchJson (url, githubToken) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {})
      }
    })

    if (!response.ok) {
      const text = await response.text()
      if (response.status === 404 && url.includes('/repos/')) {
        if (githubToken) {
          throw new Error('Repository not accessible with the current token. Ensure this token can read this repository (fine-grained: Contents=Read + selected repo; classic: repo scope, and SSO authorized if required).')
        }
        throw new Error('Repository not accessible. If it is private, set a GitHub token in extension options with repository read permissions.')
      }
      if (response.status === 401) {
        throw new Error('GitHub token rejected (401). Update the token in extension options and try again.')
      }
      if (response.status === 403) {
        throw new Error('GitHub API access denied or rate-limited (403). Verify token permissions/SSO or add a valid token in extension options.')
      }
      throw new Error(`GitHub API error ${response.status}: ${text}`)
    }
    return await response.json()
  }

  async function fetchDefaultBranch (owner, repo, githubToken) {
    const cacheKey = `${owner}/${repo}`
    const cachedBranch = getCachedValue(requestCache.defaultBranch, cacheKey)
    if (cachedBranch) return cachedBranch

    const repoData = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, githubToken)
    const defaultBranch = repoData.default_branch
    setCachedValue(requestCache.defaultBranch, cacheKey, defaultBranch, CACHE_LIMITS.defaultBranch)
    return defaultBranch
  }

  async function fetchRepositoryTree (owner, repo, ref, githubToken) {
    const resolvedRef = ref && ref !== 'HEAD'
      ? ref
      : await fetchDefaultBranch(owner, repo, githubToken)

    const cacheKey = `${owner}/${repo}@${resolvedRef}`
    const cachedTree = getCachedValue(requestCache.tree, cacheKey)
    if (cachedTree) {
      return { resolvedRef, tree: cachedTree }
    }

    const data = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`,
      githubToken
    )

    if (!data.tree || !Array.isArray(data.tree)) {
      throw new Error('Could not fetch repository tree')
    }

    setCachedValue(requestCache.tree, cacheKey, data.tree, CACHE_LIMITS.tree)
    return { resolvedRef, tree: data.tree }
  }

  async function fetchBlobContent (owner, repo, sha, githubToken) {
    const cacheKey = `${owner}/${repo}@${sha}`
    const cachedBlobContent = getCachedValue(requestCache.blob, cacheKey)
    if (cachedBlobContent) return cachedBlobContent

    const blob = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
      githubToken
    )

    if (!blob.content || blob.encoding !== 'base64') {
      throw new Error(`Unsupported blob payload for sha ${sha}`)
    }

    const blobContent = decodeBase64Utf8(blob.content)
    setCachedValue(requestCache.blob, cacheKey, blobContent, CACHE_LIMITS.blob)
    return blobContent
  }

  async function fetchCommitList (owner, repo, ref, githubToken, perPage, page) {
    const cacheKey = `${owner}/${repo}@${ref}:perPage=${perPage}:page=${page}`
    const cached = getCachedValue(requestCache.commitList, cacheKey)
    if (cached) return cached

    const data = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(ref)}&per_page=${perPage}&page=${page}`,
      githubToken
    )

    setCachedValue(requestCache.commitList, cacheKey, data, CACHE_LIMITS.commitList)
    return data
  }

  async function fetchCommitDetail (owner, repo, sha, githubToken) {
    const cacheKey = `${owner}/${repo}@${sha}`
    const cached = getCachedValue(requestCache.commitDetail, cacheKey)
    if (cached) return cached

    const data = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`,
      githubToken
    )

    setCachedValue(requestCache.commitDetail, cacheKey, data, CACHE_LIMITS.commitDetail)
    return data
  }

  function buildPseudoPath (pseudoRoot, repoPath) {
    return joinPath(pseudoRoot, repoPath)
  }

  function getRepoPathFromPseudo (pseudoPath, pseudoRoot) {
    const normalizedPseudo = normalizePath(pseudoPath)
    const normalizedRoot = normalizePath(pseudoRoot)
    if (normalizedPseudo.startsWith(`${normalizedRoot}/`)) {
      return normalizedPseudo.slice(normalizedRoot.length + 1)
    }
    return normalizedPseudo.replace(/^\/+/, '')
  }

  function getPackageIdFromPseudo (pseudoPath, pseudoRoot) {
    const repoPath = getRepoPathFromPseudo(pseudoPath, pseudoRoot)
    const dir = dirname(`/${repoPath}`).replace(/^\/+/, '')
    return dir || '.'
  }

  function roundTo4 (value) {
    return Number(Number(value || 0).toFixed(4))
  }

  async function fetchTemporalCommitFileSets ({
    owner,
    repo,
    ref,
    githubToken,
    analyzedRepoPathSet,
    pseudoRoot
  }) {
    const maxCommits = githubToken ? 48 : 20
    const perPage = 100
    const maxPages = 2
    const commitShas = []

    for (let page = 1; page <= maxPages && commitShas.length < maxCommits; page++) {
      const commitList = await fetchCommitList(owner, repo, ref, githubToken, perPage, page)
      if (!Array.isArray(commitList) || commitList.length === 0) break

      for (const item of commitList) {
        const sha = item?.sha
        if (typeof sha === 'string' && sha.length > 0) {
          commitShas.push(sha)
          if (commitShas.length >= maxCommits) break
        }
      }

      if (commitList.length < perPage) break
    }

    const uniqueShas = Array.from(new Set(commitShas))
    const details = await mapLimit(uniqueShas, 4, async (sha) => {
      try {
        return await fetchCommitDetail(owner, repo, sha, githubToken)
      } catch {
        return null
      }
    })

    const fileSets = []
    for (const detail of details) {
      const files = Array.isArray(detail?.files) ? detail.files : []
      const analyzedFiles = files
        .map(file => file?.filename)
        .filter(filePath => typeof filePath === 'string' && analyzedRepoPathSet.has(filePath))

      const uniqueRepoPaths = Array.from(new Set(analyzedFiles))
      if (uniqueRepoPaths.length < 2) continue

      fileSets.push(uniqueRepoPaths.map(repoPath => buildPseudoPath(pseudoRoot, repoPath)))
    }

    return fileSets
  }

  function createLinesPerFileMetric (context) {
    function splitLines (source) {
      if (!source || source.length === 0) return []
      const lines = source.split(/\r?\n/)
      if (lines[lines.length - 1] === '') lines.pop()
      return lines
    }

    const state = {
      name: 'Lines Per File',
      description: 'Counts total and non-empty lines for each analyzed source file',
      result: {},
      id: 'lines-per-file',
      dependencies: ['files'],
      status: false
    }

    const visitors = {
      Program (path) {
        state.currentFile = path.node.filePath
        state.result = state.dependencies.files

        const source = context.fileContentByPseudo[state.currentFile] || ''
        const lines = splitLines(source)
        const nonEmpty = lines.filter(line => line.trim() !== '').length

        state.result[state.currentFile] = {
          total: lines.length,
          nonEmpty,
          blank: lines.length - nonEmpty
        }
      }
    }

    function postProcessing (state) {
      delete state.currentFile
      delete state.dependencies
      state.status = true
    }

    return { state, visitors, postProcessing }
  }

  function createFunctionLengthMetric (context) {
    function getNodeLength (source, node) {
      if (!node || node.start == null || node.end == null) return 0
      const snippet = source.slice(node.start, node.end)
      if (!snippet) return 0
      return snippet.split(/\r?\n/).length
    }

    const state = {
      name: 'Function Length',
      description: 'Counts line spans for named functions in each source file',
      result: {},
      id: 'function-length',
      dependencies: ['functions-per-file'],
      status: false
    }

    const visitors = {
      Program (path) {
        state.currentFile = path.node.filePath
        state.result[state.currentFile] = {}

        const source = context.fileContentByPseudo[state.currentFile] || ''
        const currentFileFunctions = state.dependencies['functions-per-file'][state.currentFile] || {}

        for (const [functionName, node] of Object.entries(currentFileFunctions)) {
          state.result[state.currentFile][functionName] = {
            lines: getNodeLength(source, node)
          }
        }
      }
    }

    function postProcessing (state) {
      delete state.currentFile
      delete state.dependencies
      state.status = true
    }

    return { state, visitors, postProcessing }
  }

  function createFileCouplingMetric (context) {
    function resolveImportPath (importingFilePseudo, importSource) {
      if (typeof importSource !== 'string') return null
      if (!importSource.startsWith('.') && !importSource.startsWith('/')) return null

      const basePath = importSource.startsWith('/')
        ? joinPath(context.pseudoRoot, importSource.replace(/^\/+/, ''))
        : joinPath(dirname(importingFilePseudo), importSource)

      if (context.allRepoFilesSet.has(basePath)) return basePath

      for (const ext of IMPORT_RESOLUTION_EXTENSIONS) {
        const withExt = `${basePath}${ext}`
        if (context.allRepoFilesSet.has(withExt)) return withExt
      }

      for (const ext of IMPORT_RESOLUTION_EXTENSIONS) {
        const indexPath = joinPath(basePath, `index${ext}`)
        if (context.allRepoFilesSet.has(indexPath)) return indexPath
      }

      return null
    }

    const state = {
      name: 'File Coupling',
      description: 'Measures file-level coupling by computing each file’s fan-in (dependent files) and fan-out (dependencies)',
      result: {},
      id: 'file-coupling',
      dependencies: ['files'],
      status: false
    }

    const visitors = {
      Program (path) {
        state.currentFile = path.node.filePath
        state.result = state.dependencies.files
        state.result[state.currentFile] = []
      },

      ImportDeclaration (path) {
        const importSource = path.node.source?.value
        const absoluteImport = resolveImportPath(state.currentFile, importSource)
        if (!absoluteImport) return
        state.result[state.currentFile].push(absoluteImport)
      },

      CallExpression (path) {
        const node = path.node
        const args = node.arguments || []

        if (
          node.callee?.name === 'require' &&
          args.length === 1 &&
          args[0].type === 'StringLiteral'
        ) {
          const importSource = args[0].value
          const absoluteImport = resolveImportPath(state.currentFile, importSource)
          if (!absoluteImport) return
          state.result[state.currentFile].push(absoluteImport)
        }
      },

      TSImportEqualsDeclaration (path) {
        const importSource = path.node.moduleReference?.expression?.value
        const absoluteImport = resolveImportPath(state.currentFile, importSource)
        if (!absoluteImport) return
        state.result[state.currentFile].push(absoluteImport)
      }
    }

    function postProcessing (state) {
      const raw = state.result
      const processed = {}

      for (const filePath of Object.keys(raw)) {
        const fanOut = Array.isArray(raw[filePath]) ? raw[filePath] : []
        processed[filePath] = { fanOut: Array.from(new Set(fanOut)), fanIn: [] }
      }

      for (const filePath of Object.keys(raw)) {
        const fanOut = Array.isArray(raw[filePath]) ? raw[filePath] : []
        for (const imp of fanOut) {
          if (!processed[imp]) processed[imp] = { fanOut: [], fanIn: [] }
        }
      }

      for (const filePath of Object.keys(processed)) {
        for (const imp of processed[filePath].fanOut) {
          processed[imp].fanIn.push(filePath)
        }
      }

      for (const filePath of Object.keys(processed)) {
        processed[filePath].fanIn = Array.from(new Set(processed[filePath].fanIn))
      }

      state.result = processed
      delete state.currentFile
      delete state.dependencies
      state.status = true
    }

    return { state, visitors, postProcessing }
  }

  function createPackageCouplingMetric (context) {
    const state = {
      name: 'Package Coupling',
      description: 'Measures coupling between repository packages/directories using file dependencies',
      result: {},
      id: 'package-coupling',
      dependencies: ['file-coupling', 'lines-per-file'],
      status: false
    }

    const visitors = {
      Program (path) {
        state.currentFile = path.node.filePath
      }
    }

    function postProcessing (state) {
      const fileCoupling = state.dependencies['file-coupling'] || {}
      const linesPerFile = state.dependencies['lines-per-file'] || {}
      const packageMap = new Map()

      function getOrCreate (packageId) {
        if (!packageMap.has(packageId)) {
          packageMap.set(packageId, {
            fanOutSet: new Set(),
            fanInSet: new Set(),
            fileSet: new Set(),
            outWeights: new Map(),
            totalLines: 0,
            internalDependencies: 0,
            externalDependencies: 0
          })
        }
        return packageMap.get(packageId)
      }

      for (const [filePath, coupling] of Object.entries(fileCoupling)) {
        const sourcePackage = getPackageIdFromPseudo(filePath, context.pseudoRoot)
        const sourceEntry = getOrCreate(sourcePackage)
        sourceEntry.fileSet.add(filePath)
        sourceEntry.totalLines += Number(linesPerFile?.[filePath]?.total || 0)

        const fanOut = Array.isArray(coupling?.fanOut) ? coupling.fanOut : []
        for (const targetFilePath of fanOut) {
          const targetPackage = getPackageIdFromPseudo(targetFilePath, context.pseudoRoot)
          const targetEntry = getOrCreate(targetPackage)

          if (sourcePackage === targetPackage) {
            sourceEntry.internalDependencies += 1
            continue
          }

          sourceEntry.externalDependencies += 1
          sourceEntry.fanOutSet.add(targetPackage)
          targetEntry.fanInSet.add(sourcePackage)
          sourceEntry.outWeights.set(targetPackage, (sourceEntry.outWeights.get(targetPackage) || 0) + 1)
        }
      }

      const result = {}
      for (const [packageId, entry] of packageMap.entries()) {
        const fanOut = Array.from(entry.fanOutSet).sort()
        const fanIn = Array.from(entry.fanInSet).sort()
        const afferent = fanIn.length
        const efferent = fanOut.length
        const instability = afferent + efferent === 0 ? 0 : roundTo4(efferent / (afferent + efferent))

        result[packageId] = {
          fanOut,
          fanIn,
          weights: Object.fromEntries(entry.outWeights.entries()),
          files: entry.fileSet.size,
          lines: Math.max(0, Math.floor(entry.totalLines)),
          afferent,
          efferent,
          instability,
          internalDependencies: entry.internalDependencies,
          externalDependencies: entry.externalDependencies
        }
      }

      state.result = result
      delete state.currentFile
      delete state.dependencies
      state.status = true
    }

    return { state, visitors, postProcessing }
  }

  function createCyclicCouplingMetric () {
    const state = {
      name: 'Cyclic Coupling',
      description: 'Detects strongly connected components and reports coupling edges that belong to cycles',
      result: {},
      id: 'cyclic-coupling',
      dependencies: ['file-coupling', 'lines-per-file'],
      status: false
    }

    const visitors = {
      Program (path) {
        state.currentFile = path.node.filePath
      }
    }

    function postProcessing (state) {
      const fileCoupling = state.dependencies['file-coupling'] || {}
      const linesPerFile = state.dependencies['lines-per-file'] || {}
      const graph = {}

      for (const [filePath, coupling] of Object.entries(fileCoupling)) {
        const fanOut = Array.isArray(coupling?.fanOut) ? Array.from(new Set(coupling.fanOut)) : []
        graph[filePath] = fanOut
        for (const target of fanOut) {
          if (!graph[target]) graph[target] = []
        }
      }

      let index = 0
      const stack = []
      const onStack = new Set()
      const indexMap = new Map()
      const lowLinkMap = new Map()
      const sccs = []

      function strongConnect (node) {
        indexMap.set(node, index)
        lowLinkMap.set(node, index)
        index += 1
        stack.push(node)
        onStack.add(node)

        for (const neighbor of graph[node] || []) {
          if (!indexMap.has(neighbor)) {
            strongConnect(neighbor)
            lowLinkMap.set(node, Math.min(lowLinkMap.get(node), lowLinkMap.get(neighbor)))
          } else if (onStack.has(neighbor)) {
            lowLinkMap.set(node, Math.min(lowLinkMap.get(node), indexMap.get(neighbor)))
          }
        }

        if (lowLinkMap.get(node) === indexMap.get(node)) {
          const component = []
          while (stack.length > 0) {
            const top = stack.pop()
            onStack.delete(top)
            component.push(top)
            if (top === node) break
          }
          sccs.push(component)
        }
      }

      for (const node of Object.keys(graph)) {
        if (!indexMap.has(node)) strongConnect(node)
      }

      const cycleIdByNode = new Map()
      let cycleCounter = 0

      for (const component of sccs) {
        const hasSelfLoop = component.length === 1 && (graph[component[0]] || []).includes(component[0])
        if (component.length <= 1 && !hasSelfLoop) continue
        cycleCounter += 1
        const cycleId = `cycle-${cycleCounter}`
        for (const node of component) {
          cycleIdByNode.set(node, { cycleId, cycleSize: component.length })
        }
      }

      const cycleNodes = new Set(cycleIdByNode.keys())
      const fanInByNode = {}
      for (const node of cycleNodes) {
        fanInByNode[node] = []
      }

      for (const source of cycleNodes) {
        for (const target of graph[source] || []) {
          if (!cycleNodes.has(target)) continue
          const sourceCycle = cycleIdByNode.get(source)?.cycleId
          const targetCycle = cycleIdByNode.get(target)?.cycleId
          if (!sourceCycle || sourceCycle !== targetCycle) continue
          fanInByNode[target].push(source)
        }
      }

      const result = {}
      for (const node of cycleNodes) {
        const cycleData = cycleIdByNode.get(node)
        const fanOut = (graph[node] || []).filter((target) => {
          if (!cycleNodes.has(target)) return false
          return cycleIdByNode.get(target)?.cycleId === cycleData?.cycleId
        })
        const fanIn = Array.from(new Set(fanInByNode[node] || []))

        result[node] = {
          fanOut: Array.from(new Set(fanOut)),
          fanIn,
          cycleId: cycleData?.cycleId || null,
          cycleSize: cycleData?.cycleSize || 1,
          lines: Number(linesPerFile?.[node]?.total || 0)
        }
      }

      state.result = result
      delete state.currentFile
      delete state.dependencies
      state.status = true
    }

    return { state, visitors, postProcessing }
  }

  function createTemporalCouplingMetric (context) {
    const state = {
      name: 'Temporal Coupling',
      description: 'Measures co-change coupling using recent commits in repository history',
      result: {},
      id: 'temporal-coupling',
      dependencies: ['files', 'lines-per-file'],
      status: false
    }

    const visitors = {
      Program (path) {
        state.currentFile = path.node.filePath
      }
    }

    function postProcessing (state) {
      const linesPerFile = state.dependencies['lines-per-file'] || {}
      const commitFileSets = Array.isArray(context.temporalCommitFileSets) ? context.temporalCommitFileSets : []
      if (commitFileSets.length === 0) {
        state.result = {}
        delete state.currentFile
        delete state.dependencies
        state.status = true
        return
      }

      const coChangeMap = new Map()

      function ensureFileMap (filePath) {
        if (!coChangeMap.has(filePath)) coChangeMap.set(filePath, new Map())
        return coChangeMap.get(filePath)
      }

      for (const commitFiles of commitFileSets) {
        const files = Array.from(new Set((commitFiles || []).filter(filePath => typeof filePath === 'string')))
        if (files.length < 2) continue

        for (const sourceFile of files) {
          const sourceMap = ensureFileMap(sourceFile)
          for (const targetFile of files) {
            if (targetFile === sourceFile) continue
            sourceMap.set(targetFile, (sourceMap.get(targetFile) || 0) + 1)
          }
        }
      }

      const result = {}
      for (const [sourceFile, targetsMap] of coChangeMap.entries()) {
        const orderedTargets = Array.from(targetsMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40)

        const fanOut = orderedTargets.map(([target]) => target)
        const fanIn = []
        let temporalOut = 0
        for (const [, weight] of orderedTargets) temporalOut += weight

        for (const [candidateSource, candidateTargets] of coChangeMap.entries()) {
          if (candidateSource === sourceFile) continue
          if (candidateTargets.has(sourceFile)) fanIn.push(candidateSource)
        }

        let temporalIn = 0
        for (const sourceCandidate of fanIn) {
          temporalIn += Number(coChangeMap.get(sourceCandidate)?.get(sourceFile) || 0)
        }

        result[sourceFile] = {
          fanOut,
          fanIn: Array.from(new Set(fanIn)),
          weights: Object.fromEntries(orderedTargets),
          temporalOut,
          temporalIn,
          lines: Number(linesPerFile?.[sourceFile]?.total || 0)
        }
      }

      state.result = result
      delete state.currentFile
      delete state.dependencies
      state.status = true
    }

    return { state, visitors, postProcessing }
  }

  function getMetricModuleUrl (fileName, runToken, options = {}) {
    const cacheBust = `run=${encodeURIComponent(runToken)}`
    const metricBaseUrl = options.metricBaseUrl || self.__VTJMETRICS_METRIC_BASE_URL || 'metric-src'
    const hasChromeRuntime = typeof chrome !== 'undefined' && chrome?.runtime?.getURL

    if (hasChromeRuntime) {
      return `${chrome.runtime.getURL(`metric-src/${fileName}`)}?${cacheBust}`
    }

    const baseHint = (typeof document !== 'undefined' && document.baseURI)
      ? document.baseURI
      : ((typeof self !== 'undefined' && self.location && self.location.href) ? self.location.href : undefined)

    const normalizedBaseInput = String(metricBaseUrl || 'metric-src').replace(/\/+$/, '')
    const absoluteBase = (() => {
      try {
        const baseUrl = new URL(normalizedBaseInput, baseHint || undefined)
        return `${baseUrl.href.replace(/\/+$/, '')}/`
      } catch {
        return `${normalizedBaseInput}/`
      }
    })()

    try {
      return new URL(`${fileName}?${cacheBust}`, absoluteBase).href
    } catch {
      return `${absoluteBase}${fileName}?${cacheBust}`
    }
  }

  async function loadMetricFromSource (metricId, runToken, options = {}) {
    const fileName = METRIC_FILES[metricId]
    const moduleUrl = getMetricModuleUrl(fileName, runToken, options)
    const metricModule = await import(moduleUrl)
    if (!metricModule || !metricModule.state || !metricModule.visitors || !metricModule.postProcessing) {
      throw new Error(`Invalid metric module exports: ${fileName}`)
    }
    return {
      state: metricModule.state,
      visitors: metricModule.visitors,
      postProcessing: metricModule.postProcessing
    }
  }

  async function loadMetricObjects (context, runToken, options = {}) {
    const metrics = []

    for (const metricId of METRIC_IDS) {
      if (metricId === 'file-coupling') {
        metrics.push(createFileCouplingMetric(context))
        continue
      }
      if (metricId === 'lines-per-file') {
        metrics.push(createLinesPerFileMetric(context))
        continue
      }
      if (metricId === 'function-length') {
        metrics.push(createFunctionLengthMetric(context))
        continue
      }
      if (metricId === 'package-coupling') {
        metrics.push(createPackageCouplingMetric(context))
        continue
      }
      if (metricId === 'cyclic-coupling') {
        metrics.push(createCyclicCouplingMetric())
        continue
      }
      if (metricId === 'temporal-coupling') {
        metrics.push(createTemporalCouplingMetric(context))
        continue
      }

      metrics.push(await loadMetricFromSource(metricId, runToken, options))
    }

    return metrics
  }

  function kahnSort (metrics, logger) {
    const adj = {}
    const indegree = {}
    const map = {}

    for (const metric of metrics) {
      const id = metric.state.id
      if (map[id]) throw new Error(`Duplicate metric ID detected: ${id}`)
      map[id] = metric
      adj[id] = []
      indegree[id] = 0
    }

    for (const metric of metrics) {
      const deps = metric.state.dependencies || []
      for (const dep of deps) {
        if (!map[dep]) {
          logger.logMetricError(`Dependency ${dep} not found for metric ${metric.state.id}, deleting from dependencies.`)
          metric.state.dependencies = deps.filter(d => d !== dep)
        }
      }
    }

    for (const metric of metrics) {
      for (const dep of metric.state.dependencies || []) {
        adj[dep].push(metric.state.id)
        indegree[metric.state.id] += 1
      }
    }

    const queue = Object.keys(indegree).filter(id => indegree[id] === 0).sort()
    const order = []

    while (queue.length > 0) {
      const id = queue.shift()
      const metric = map[id]
      order.push(metric)

      for (const depId of adj[id]) {
        indegree[depId] -= 1
        if (indegree[depId] === 0) {
          queue.push(depId)
          queue.sort()
        }
      }
    }

    if (order.length !== metrics.length) {
      throw new Error('Cycle detected on metric dependencies')
    }

    return order
  }

  function resolveDependencies (metric, resultMap) {
    if (!metric.state.dependencies) return
    const deps = metric.state.dependencies
    metric.state.dependencies = {}
    for (const depId of deps) {
      metric.state.dependencies[depId] = deepClone(resultMap[depId])
    }
  }

  function traverseASTs (metric, asts, logger) {
    const traverse = self.Babel.packages.traverse.default || self.Babel.packages.traverse
    for (const ast of asts) {
      try {
        traverse(ast, metric.visitors, null, metric.state)
      } catch (error) {
        logger.logTraverseError(`Error traversing AST on metric ${metric.state.id} -> ${ast.program.filePath}: ${error}`)
      }
    }
  }

  function buildFinalResult (sortedMetrics, logger) {
    const output = {}
    for (const metric of sortedMetrics) {
      if (metric.state.ignore) continue
      const { id, ...rest } = metric.state
      output[id] = rest
    }

    output.errors = {
      file: logger.getFileErrors(),
      parse: logger.getParseErrors(),
      metric: logger.getMetricErrors(),
      traverse: logger.getTraverseErrors()
    }
    return output
  }

  function parseAstsFromFiles (files, fileContentByPseudo, logger) {
    const parser = self.Babel.packages.parser
    const asts = []

    for (const file of files) {
      try {
        const code = fileContentByPseudo[file.filePath]
        const ast = parser.parse(code, PARSER_OPTIONS)
        ast.program.filePath = file.filePath
        asts.push(ast)
      } catch (error) {
        logger.logParseError(`Error parsing file ${file.filePath}: ${error.message}`)
      }
    }

    return asts
  }

  async function runEngineOnContext ({ context, files, metricLoadOptions = {} }) {
    const logger = createLogger()
    const asts = parseAstsFromFiles(files, context.fileContentByPseudo, logger)
    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const metricObjects = await loadMetricObjects(context, runToken, metricLoadOptions)
    const sortedMetrics = kahnSort(metricObjects, logger)

    const resultMap = {}
    for (const metric of sortedMetrics) {
      resolveDependencies(metric, resultMap)
      traverseASTs(metric, asts, logger)
      resultMap[metric.state.id] = metric.state.result
    }

    for (const metric of sortedMetrics) {
      if (metric.postProcessing) metric.postProcessing(metric.state)
      resultMap[metric.state.id] = metric.state.result
    }

    return buildFinalResult(sortedMetrics, logger)
  }

  async function runEngine ({ owner, repo, ref, sourcePath, githubToken, metricBaseUrl }) {
    const pseudoRoot = `/${owner}/${repo}`
    const sanitizedSourcePath = sanitizeSourcePath(sourcePath)

    const { resolvedRef, tree } = await fetchRepositoryTree(owner, repo, ref, githubToken)
    const blobEntries = tree.filter(entry => entry.type === 'blob')

    if (blobEntries.length === 0) {
      throw new Error('Repository has no files to analyze')
    }

    const scopedEntries = blobEntries.filter(entry => isPathInsideSourcePath(entry.path, sanitizedSourcePath))
    if (scopedEntries.length === 0) {
      throw new Error(`Path "${sourcePath}" was not found in ${owner}/${repo}@${resolvedRef}`)
    }

    const supportedEntries = scopedEntries.filter(entry => SUPPORTED_EXTENSIONS.has(extname(entry.path)))
    if (supportedEntries.length === 0) {
      throw new Error(`No supported files (.js, .cjs, .ts) found under "${sourcePath}"`)
    }

    const analyzedRepoPathSet = new Set(supportedEntries.map(entry => entry.path))
    const allRepoFilesSet = new Set(blobEntries.map(entry => buildPseudoPath(pseudoRoot, entry.path)))

    const fileContentByPseudo = {}
    await mapLimit(supportedEntries, 8, async (entry) => {
      const source = await fetchBlobContent(owner, repo, entry.sha, githubToken)
      const pseudoPath = buildPseudoPath(pseudoRoot, entry.path)
      fileContentByPseudo[pseudoPath] = source
    })

    const files = supportedEntries.map(entry => ({
      filePath: buildPseudoPath(pseudoRoot, entry.path),
      fileName: entry.path.split('/').pop()
    }))

    let temporalCommitFileSets = []
    try {
      temporalCommitFileSets = await fetchTemporalCommitFileSets({
        owner,
        repo,
        ref: resolvedRef,
        githubToken,
        analyzedRepoPathSet,
        pseudoRoot
      })
    } catch {
      temporalCommitFileSets = []
    }

    const context = {
      pseudoRoot,
      allRepoFilesSet,
      fileContentByPseudo,
      temporalCommitFileSets
    }
    const output = await runEngineOnContext({
      context,
      files,
      metricLoadOptions: { metricBaseUrl }
    })
    output._meta = {
      ...(output._meta || {}),
      owner,
      repo,
      ref: resolvedRef,
      sourcePath: sanitizedSourcePath,
      temporalCommits: temporalCommitFileSets.length,
      inputType: 'github'
    }
    return output
  }

  function normalizeRepoRelativePath (inputPath) {
    return normalizePath(String(inputPath || '').replace(/\\/g, '/')).replace(/^\/+/, '')
  }

  function stripSingleTopDirectory (paths) {
    if (!paths || paths.length === 0) return paths

    const firstSegments = new Set()
    for (const rawPath of paths) {
      const normalized = normalizeRepoRelativePath(rawPath)
      if (!normalized) continue
      const first = normalized.split('/')[0]
      if (!first) return paths
      firstSegments.add(first)
      if (firstSegments.size > 1) return paths
    }

    if (firstSegments.size !== 1) return paths

    const hasNestedPath = paths.some(rawPath => normalizeRepoRelativePath(rawPath).includes('/'))
    if (!hasNestedPath) return paths

    const [singlePrefix] = [...firstSegments]
    return paths.map((rawPath) => {
      const normalized = normalizeRepoRelativePath(rawPath)
      return normalized.startsWith(`${singlePrefix}/`) ? normalized.slice(singlePrefix.length + 1) : normalized
    })
  }

  async function runEngineFromFileMap ({ filesByPath, sourcePath = '.', projectName = 'local-project', metricBaseUrl }) {
    if (!filesByPath || typeof filesByPath !== 'object') {
      throw new Error('filesByPath must be an object (path -> source code).')
    }

    const rawEntries = Object.entries(filesByPath)
      .map(([repoPath, content]) => [normalizeRepoRelativePath(repoPath), String(content ?? '')])
      .filter(([repoPath]) => Boolean(repoPath))

    if (rawEntries.length === 0) {
      throw new Error('No files were provided to analyze')
    }

    const normalizedPaths = stripSingleTopDirectory(rawEntries.map(([repoPath]) => repoPath))
    const normalizedEntries = rawEntries.map(([, content], index) => [normalizedPaths[index], content])
    const sanitizedSourcePath = sanitizeSourcePath(sourcePath || '.')

    const scopedEntries = normalizedEntries.filter(([repoPath]) => isPathInsideSourcePath(repoPath, sanitizedSourcePath))
    if (scopedEntries.length === 0) {
      throw new Error(`Path "${sourcePath}" was not found in uploaded files`)
    }

    const supportedEntries = scopedEntries.filter(([repoPath]) => SUPPORTED_EXTENSIONS.has(extname(repoPath)))
    if (supportedEntries.length === 0) {
      throw new Error(`No supported files (.js, .cjs, .ts) found under "${sourcePath}"`)
    }

    const normalizedProjectName = normalizeRepoRelativePath(projectName) || 'local-project'
    const pseudoRoot = `/${normalizedProjectName}`
    const allRepoFilesSet = new Set(normalizedEntries.map(([repoPath]) => buildPseudoPath(pseudoRoot, repoPath)))

    const fileContentByPseudo = {}
    for (const [repoPath, content] of supportedEntries) {
      fileContentByPseudo[buildPseudoPath(pseudoRoot, repoPath)] = content
    }

    const files = supportedEntries.map(([repoPath]) => ({
      filePath: buildPseudoPath(pseudoRoot, repoPath),
      fileName: repoPath.split('/').pop()
    }))

    const context = {
      pseudoRoot,
      allRepoFilesSet,
      fileContentByPseudo,
      temporalCommitFileSets: []
    }
    const output = await runEngineOnContext({
      context,
      files,
      metricLoadOptions: { metricBaseUrl }
    })

    output._meta = {
      ...(output._meta || {}),
      projectName: normalizedProjectName,
      sourcePath: sanitizedSourcePath,
      analyzedFiles: files.length,
      inputType: 'file-map'
    }
    return output
  }

  self.runJTMetricsInBrowser = async function runJTMetricsInBrowser (payload) {
    const { owner, repo, sourcePath } = payload
    if (!owner || !repo || !sourcePath) {
      throw new Error('Missing required fields: owner, repo, sourcePath')
    }
    return await runEngine(payload)
  }

  self.runJTMetricsFromFilesInBrowser = async function runJTMetricsFromFilesInBrowser (payload) {
    const { filesByPath, sourcePath, projectName, metricBaseUrl } = payload || {}
    return await runEngineFromFileMap({
      filesByPath,
      sourcePath: sourcePath || '.',
      projectName: projectName || 'local-project',
      metricBaseUrl
    })
  }
})()
