const tokenInput = document.getElementById('github-token')
const saveBtn = document.getElementById('save-btn')
const status = document.getElementById('status')

async function loadOptions () {
  const stored = await chrome.storage.sync.get(['jtmetricsGitHubToken'])
  tokenInput.value = stored.jtmetricsGitHubToken || ''
}

async function saveOptions () {
  const githubToken = tokenInput.value.trim()

  await chrome.storage.sync.set({
    jtmetricsGitHubToken: githubToken
  })

  status.textContent = 'Saved.'
  setTimeout(() => { status.textContent = '' }, 1800)
}

saveBtn.addEventListener('click', saveOptions)
loadOptions()
