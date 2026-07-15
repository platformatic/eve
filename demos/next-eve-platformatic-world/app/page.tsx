import { AgentConsole } from './components/agent-console'

export default function HomePage () {
  return (
    <main className='shell'>
      <div className='powered-bar' aria-label='Powered by ICC, Watt, Next.js, Eve and Platformatic World'>
        <strong>Powered by</strong>
        <div>
          <span>ICC</span><i>→</i><span>Watt</span><i>→</i><span>Next.js</span><i>→</i><span>Eve</span><i>→</i><span>Platformatic World</span>
        </div>
      </div>
      <header className='masthead'>
        <div className='hero-copy'>
          <p className='eyebrow'>Live campaign orchestration</p>
          <h1>One brief. <em>Campaign live.</em></h1>
          <p className='hero-lede'>Turn a campaign idea into coordinated, durable execution across markets, content and channels in under 30 seconds.</p>
        </div>
        <div className='hero-stamp' aria-label='Demo duration'>
          <strong>30</strong>
          <span>second<br />live launch</span>
        </div>
      </header>
      <AgentConsole />
    </main>
  )
}
