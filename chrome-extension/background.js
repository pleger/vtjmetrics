importScripts('./vendor/babel.min.js', './browser-engine.js')

async function getConfig () {
  const stored = await chrome.storage.sync.get(['jtmetricsGitHubToken'])
  return {
    githubToken: stored.jtmetricsGitHubToken || ''
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'JTMETRICS_CALCULATE') return undefined

  ;(async () => {
    try {
      const { githubToken } = await getConfig()
      const data = await self.runJTMetricsInBrowser({
        ...message.payload,
        githubToken
      })
      sendResponse({ ok: true, data })
    } catch (error) {
      sendResponse({ ok: false, error: error.message })
    }
  })()

  return true
})
