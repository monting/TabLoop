import './style.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="header">
    <h1>TabLoop</h1>
    <p>Enhance your browsing experience</p>
  </div>
  
  <div class="card">
    <button id="action-btn" class="btn-primary">
      Initialize Loop
    </button>
    
    <div class="stats">
      <div class="stat-item">
        <span class="stat-value" id="clicks-val">0</span>
        <span class="stat-label">Loops</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">Active</span>
        <span class="stat-label">Status</span>
      </div>
    </div>
  </div>
`

const actionBtn = document.querySelector<HTMLButtonElement>('#action-btn')!
const clicksVal = document.querySelector<HTMLSpanElement>('#clicks-val')!

let clicks = 0
actionBtn.addEventListener('click', () => {
  clicks++
  clicksVal.innerText = clicks.toString()
  actionBtn.innerText = `Loop Active (${clicks})`
})
