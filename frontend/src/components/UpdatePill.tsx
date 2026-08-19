import {useEffect,useRef,useState} from 'react'
import {Events} from '@wailsio/runtime'
import {ArrowUp,X} from '@phosphor-icons/react'
import {Button} from './ui/button'
import {Spinner} from './ui/spinner'
import {useTranslation} from 'react-i18next'
import {InstallUpdate,RestartApp} from '../../bindings/changeme/updateservice'
import {toast} from './AppToast'
import './UpdatePill.css'

type PillState='checking'|'available'|'downloading'|'applying'|'restarting'
const payload=(event:any)=>event?.data??event
const formatVersion=(value:unknown)=>{const v=String(value??'').trim().replace(/^v/i,'');return v?`v${v}`:''}

export default function UpdatePill(){
  const{t}=useTranslation()
  const[state,setStateRaw]=useState<PillState|null>(null)
  const[version,setVersion]=useState('')
  const[percent,setPercent]=useState(0)
  const stateRef=useRef<PillState|null>(null)
  const dismissed=useRef(false)
  const errorHandled=useRef(false)
  const setState=(next:PillState|null)=>{stateRef.current=next;setStateRaw(next)}
  useEffect(()=>{
    const on=(name:string,handler:(event:any)=>void)=>Events.On(name,handler)
    const onLocalCheck=(event:Event)=>{const state=(event as CustomEvent<PillState|'finished'|'available'>).detail;if(state==='checking'){dismissed.current=false;setPercent(0);setState('checking')}else if(state==='finished'&&stateRef.current==='checking')setState(null)}
    window.addEventListener('devutils:update-check',onLocalCheck)
    const off=[
      on('wails:updater:update-available',e=>{if(dismissed.current)return;setVersion(formatVersion(payload(e)?.version));setPercent(0);errorHandled.current=false;setState('available')}),
      on('wails:updater:no-update',()=>setState(null)),
      on('wails:updater:download-started',()=>{setPercent(0);setState('downloading')}),
      on('wails:updater:download-progress',e=>{const p=payload(e);if(p?.total)setPercent(Math.round(p.written/p.total*100))}),
      on('wails:updater:verifying',()=>setState('applying')),
      on('wails:updater:installing',()=>setState('applying')),
      on('wails:updater:update-ready',()=>{setState('restarting');void RestartApp().catch(()=>{if(!errorHandled.current){toast(t('updatePill.error'),{variant:'danger'});setState('available')}})}),
      on('wails:updater:error',e=>{if(stateRef.current==='downloading'||stateRef.current==='applying'||stateRef.current==='restarting'){errorHandled.current=true;toast(t('updatePill.error'),{description:payload(e)?.message||'',variant:'danger'});setState('available')}}),
    ]
    return()=>{off.forEach(cancel=>cancel?.());window.removeEventListener('devutils:update-check',onLocalCheck)}
  },[t])
  const start=()=>{errorHandled.current=false;setState('downloading');void InstallUpdate().catch(()=>{if(!errorHandled.current){toast(t('updatePill.error'),{variant:'danger'});setState('available')}})}
  const dismiss=()=>{dismissed.current=true;setState(null)}
  if(!state)return null
  const working=state!=='available'
  const label=state==='checking'?t('updatePill.checking'):state==='available'?t('updatePill.available',{version}):state==='downloading'?t('updatePill.downloading'):state==='applying'?t('updatePill.applying'):t('updatePill.restarting')
  if(working)return <div className="update-pill update-pill--working" role="status"><Spinner className="update-pill__spinner text-(--primary)" size={14}/><span className="update-pill__label">{label}{state==='downloading'&&percent>0?` ${percent}%`:''}</span></div>
  return <div className="update-pill update-pill--available" role="status"><Button variant="ghost" className="update-pill__action" onClick={start} aria-label={label}><ArrowUp size={13} weight="duotone"/><span className="update-pill__label">{label}</span></Button><Button variant="ghost" className="update-pill__close p-0" aria-label={t('updatePill.dismiss')} title={t('updatePill.dismiss')} onClick={dismiss}><X size={11} weight="bold"/></Button></div>
}
