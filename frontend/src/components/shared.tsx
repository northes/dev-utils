import {useEffect, useRef, useState} from 'react'
import {BracketsCurly} from '@phosphor-icons/react'

export type ToolId = 'json' | 'time' | 'text'
export type PendingAction = {tool:ToolId;action:string;input:string}
export type Icon = typeof BracketsCurly
export const samples={json:'{"project":"DevUtils","version":1,"features":["search","clipboard","privacy"],"owner":{"team":"developer experience","active":true}}',text:'  Build tools that stay out of the way.\nShip faster, keep data local.  '}
export function Reveal({children,index,fill}:{children:React.ReactNode;index?:number;fill?:boolean}){const ref=useRef<HTMLDivElement>(null);const[visible,setVisible]=useState(false);useEffect(()=>{const el=ref.current;if(!el)return;const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);io.disconnect()}},{threshold:.12});io.observe(el);return()=>io.disconnect()},[]);return<div ref={ref} className={`reveal${visible?' is-visible':''}${fill?' reveal-fill':''}`} style={{'--index':index??0} as React.CSSProperties}>{children}</div>}
export function ToolHeader({icon:Icon,title,subtitle}:{icon:Icon;title:string;subtitle:string}){return <header className="tool-header"><span className="tool-heading-icon"><Icon size={17} weight="bold"/></span><div><h1>{title}</h1><p>{subtitle}</p></div></header>}
export function Editor({label,value,onChange,readOnly}:{label:string;value:string;onChange?:(v:string)=>void;readOnly?:boolean}){return <label className="editor"><span>{label}</span><textarea value={value} readOnly={readOnly} spellCheck={false} onChange={e=>onChange?.(e.target.value)}/></label>}
