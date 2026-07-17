'use client'

import { useState } from 'react'
import { useEveAgent } from 'eve/react'

interface SavedSession {
  events?: readonly unknown[]
  session?: { sessionId?: string, continuationToken?: string, streamIndex: number }
}

interface CampaignResult {
  stage: number
  phase: string
  action: string
  system: string
  summary: string
  metricLabel: string
  metricValue: string
  durationMs: number
  deploymentVersion: string
  buildVersion: string
  pod: string
  runtime: string
  workerId: string
  pid: number
}

const STORAGE_KEY = 'velocity-campaign-launch-v1'
const CAMPAIGN_PROMPT = 'Launch the Velocity running shoe campaign across Europe.'
const PHASES = [
  { title: 'Campaign brief', action: 'POST /campaigns/velocity/plan', system: 'Campaign API', copy: 'Position the new Velocity shoe for urban runners.' },
  { title: 'Audience intelligence', action: 'QUERY audience_graph', system: 'Audience service', copy: 'Find high-intent audiences in launch markets.' },
  { title: 'Inventory alignment', action: 'POST /inventory/reservations', system: 'Inventory API', copy: 'Protect availability before demand goes live.' },
  { title: 'Creative studio', action: 'POST /creative/render', system: 'Creative engine', copy: 'Shape localized stories for every segment.' },
  { title: 'Channel activation', action: 'POST /channels/schedule', system: 'Channel scheduler', copy: 'Synchronize web, mobile, email and social.' },
  { title: 'Campaign live', action: 'POST /campaigns/velocity/publish', system: 'Campaign API', copy: 'Launch everywhere with one coordinated action.' }
]
export function AgentConsole () {
  const [token, setToken] = useState<string>()
  const [candidate, setCandidate] = useState('')

  if (token === undefined) {
    return (
      <section className='auth-gate'>
        <p className='kicker'>Protected demo</p>
        <h2>Enter the demo token.</h2>
        <p>The token stays in this browser tab and is sent only as an authorization header.</p>
        <form onSubmit={event => {
          event.preventDefault()
          if (candidate.length === 0) {
            return
          }
          setToken(candidate)
          setCandidate('')
        }}>
          <label htmlFor='demo-token'>Bearer token</label>
          <div>
            <input
              autoComplete='current-password'
              id='demo-token'
              onChange={event => setCandidate(event.target.value)}
              required
              type='password'
              value={candidate}
            />
            <button type='submit'>Unlock demo</button>
          </div>
        </form>
      </section>
    )
  }

  return <AuthenticatedAgentConsole onChangeToken={() => setToken(undefined)} token={token} />
}

function AuthenticatedAgentConsole ({ onChangeToken, token }: { onChangeToken: () => void, token: string }) {
  const [saved] = useState<SavedSession>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedSession } catch { return {} }
  })
  const [runStartIndex, setRunStartIndex] = useState(0)
  const agent = useEveAgent({
    auth: { bearer: token },
    host: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
    initialEvents: saved.events as never[] | undefined,
    initialSession: saved.session,
    maxReconnectAttempts: 8,
    onFinish (snapshot) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: snapshot.events, session: snapshot.session }))
    }
  })
  const events = agent.events as ReadonlyArray<{ type: string, data?: any }>
  const results = events.slice(runStartIndex).flatMap(event => {
    const output = event.type === 'action.result' ? event.data?.result?.output : undefined
    return output?.metricValue === undefined ? [] : [output as CampaignResult]
  })
  const busy = agent.status === 'submitted' || agent.status === 'streaming'
  const complete = results.length >= PHASES.length && !busy
  const activeIndex = Math.min(results.length, PHASES.length - 1)
  const latest = results.at(-1)
  const currentOperation = complete ? latest : PHASES[activeIndex]
  const progress = Math.round(results.length / PHASES.length * 100)

  function launch () {
    setRunStartIndex(events.length)
    void agent.send({ message: CAMPAIGN_PROMPT })
  }

  function reset () {
    localStorage.removeItem(STORAGE_KEY)
    setRunStartIndex(0)
    agent.reset()
  }

  return (
    <>
      <div className='auth-status'>
        <span>Bearer token active</span>
        <button className='text-button' disabled={busy} onClick={onChangeToken} type='button'>Change token</button>
      </div>
      <section className='experience-grid'>
        <article className='brief-card'>
          <div className='product-art' aria-label='Velocity campaign artwork'>
            <span className='product-edition'>01 / EUROPE</span>
            <strong>VELOCITY</strong>
            <div className='orbit orbit-one' /><div className='orbit orbit-two' />
            <span className='product-tag'>Run beyond</span>
          </div>
          <div className='brief-body'>
            <div className='brief-heading'>
              <div><p className='kicker'>Launch brief</p><h2>Velocity Europe</h2></div>
              <span className='ready-pill'>Ready</span>
            </div>
            <p className='brief-copy'>{CAMPAIGN_PROMPT}</p>
            <dl className='brief-facts'>
              <div><dt>Markets</dt><dd>Berlin, Paris, Milan</dd></div>
              <div><dt>Audience</dt><dd>Urban runners, 20-40</dd></div>
              <div><dt>Channels</dt><dd>Web, mobile, email, social</dd></div>
            </dl>
            <div className='launch-actions'>
              <button className='launch-button' disabled={busy || complete} onClick={launch} type='button'>
                <span>{complete ? 'Campaign live' : busy ? 'Launching campaign' : 'Launch campaign'}</span><b>{busy ? `${progress}%` : complete ? '✓' : '→'}</b>
              </button>
              {(results.length > 0 || agent.session.sessionId) && <button className='text-button' disabled={busy} onClick={reset} type='button'>Start over</button>}
            </div>
            {agent.error && <p className='error-banner'>{agent.error.message}</p>}
          </div>
        </article>

        <article className={`launch-board ${complete ? 'launch-complete' : ''}`}>
          <div className='launch-board-head'>
            <div><p className='kicker'>{complete ? 'Campaign status' : 'Workflow execution'}</p><h2>{complete ? 'Velocity is live.' : busy ? PHASES[activeIndex].title : 'Ready when you are.'}</h2></div>
            <span className={`live-badge ${complete ? 'is-live' : ''}`}><i />{complete ? 'LIVE' : busy ? 'IN PROGRESS' : 'STANDBY'}</span>
          </div>
          <div className='current-operation'>
            <span>{complete ? 'Last action' : 'Current action'}</span>
            <code>{currentOperation?.action ?? 'Waiting for launch'}</code>
            <b>{currentOperation?.system ?? 'Eve workflow'}</b>
          </div>
          <div className='progress-track' aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
          <ol className='campaign-phases'>
            {PHASES.map((phase, index) => {
              const result = results.find(item => item.stage === index + 1)
              const active = busy && activeIndex === index
              return (
                <li className={result ? 'is-done' : active ? 'is-active' : ''} key={phase.title}>
                  <span className='phase-number'>{result ? '✓' : String(index + 1).padStart(2, '0')}</span>
                  <div className='phase-copy'><b>{phase.title}</b><p>{result?.summary ?? phase.copy}</p><code>{result?.action ?? phase.action}</code><small>{result?.system ?? phase.system}</small></div>
                  <div className='phase-metric'>{result ? <><strong>{result.metricValue}</strong><small>{result.metricLabel}</small></> : active ? <span>Working</span> : null}</div>
                </li>
              )
            })}
          </ol>
          {complete && <div className='success-note'><span>Launch complete</span><p>Three markets, four channels and twelve creative variants are now live as one coordinated campaign.</p></div>}
        </article>
      </section>

      <section className='impact-strip' aria-label='Campaign impact'>
        {PHASES.map((phase, index) => {
          const result = results.find(item => item.stage === index + 1)
          return <article className={result ? 'revealed' : ''} key={phase.title}><strong>{result?.metricValue ?? '—'}</strong><span>{result?.metricLabel ?? phase.title}</span></article>
        })}
      </section>

      <section className='runtime-section'>
        <details className='runtime-proof'>
          <summary>See runtime proof <span>session, deployment and event stream</span></summary>
          <div className='proof-grid'>
            <dl>
              <div><dt>Session</dt><dd>{agent.session.sessionId ?? 'Not started'}</dd></div>
              <div><dt>Deployment</dt><dd>{latest?.deploymentVersion ?? 'Waiting'}</dd></div>
              <div><dt>Build</dt><dd>{latest?.buildVersion ?? 'Waiting'}</dd></div>
              <div><dt>Pod</dt><dd>{latest?.pod ?? 'Waiting'}</dd></div>
              <div><dt>Events</dt><dd>{events.length}</dd></div>
            </dl>
            <ol className='event-proof'>
              {events.slice(-10).map((event, index) => <li key={`${event.type}-${index}`}><span>{String(events.length - Math.min(events.length, 10) + index + 1).padStart(2, '0')}</span>{event.type}</li>)}
            </ol>
          </div>
        </details>
      </section>
    </>
  )
}
