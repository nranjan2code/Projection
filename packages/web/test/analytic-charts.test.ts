import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartDomain, normalizeChart, renderChart } from '../src/chart.ts';
import { fakeDoc, findAll, textOf } from './dom.ts';
import { basicCatalog, SurfaceStore } from '@vak/core';

test('trend scales expose variation while magnitude charts retain zero and flat data stays finite',()=>{
  const line=normalizeChart({kind:'line',series:[[1158,1218,1196]]});
  const [lo,hi]=chartDomain(line);assert.ok(lo>1000&&lo<1158);assert.ok(hi>1218&&hi<1400);
  assert.equal(chartDomain({...line,yScale:'zero'})[0],0);
  assert.equal(chartDomain({...line,kind:'bar'})[0],0);
  assert.equal(chartDomain({...line,kind:'area'})[0],0);
  for(const values of [[0,0],[100,100],[-10,-10],[-2,3]]){
    const domain=chartDomain(normalizeChart({kind:'line',series:[values]}));assert.ok(domain.every(Number.isFinite));assert.ok(domain[0]<domain[1]);assert.ok(domain[0]<=Math.min(...values)&&domain[1]>=Math.max(...values));
  }
});
test('OHLC intervals render real bodies and wicks with exact accessible values and a disclosed fitted axis',()=>{
  const spec=normalizeChart({kind:'candlestick',title:'Daily observations',labels:['Day A','Day B'],series:[{values:[100,110]},{values:[112,115]},{values:[98,99]},{values:[110,101]}],height:'lg',yLabel:'INR'});
  const figure=renderChart(spec,fakeDoc(),600);
  assert.equal(findAll(figure,'rect').length,2);assert.equal(findAll(figure,'g').length,2);
  assert.equal(findAll(figure,'svg')[0]!.getAttribute('height'),'360');
  assert.match(textOf(figure),/Open 100 · High 112 · Low 98 · Close 110/);
  assert.match(textOf(figure),/baseline may exclude zero/);assert.match(textOf(figure),/Daily observations/);
  assert.ok(findAll(figure,'g')[0]!.getAttribute('aria-label')!.includes('open 100'));
});
test('horizontal signed rankings retain all categories and exact values instead of thinning long labels',()=>{
  const labels=Array.from({length:21},(_,i)=>`Long category ${i}`),values=labels.map((_,i)=>i-10);
  const chart=renderChart(normalizeChart({kind:'bar',orientation:'horizontal',colorBy:'sign',labels,series:[{values}]}),fakeDoc(),500);
  assert.equal(findAll(chart,'rect').length,21);assert.match(textOf(chart),/Long category 20/);
  assert.ok(Number(findAll(chart,'svg')[0]!.getAttribute('height'))>=21*24);
  assert.match(findAll(chart,'rect')[0]!.getAttribute('fill')!,/danger/);
  assert.match(findAll(chart,'rect')[20]!.getAttribute('fill')!,/success/);
});
test('catalog accepts mapped candles and compact density but rejects impossible or mismatched OHLC before publication',()=>{
  const data={bars:[{date:'Day A',open:100,high:112,low:98,close:110}]};
  const nodes=[{id:'root',type:'stack',props:{density:'compact'},children:['chart']},{id:'chart',type:'chart',props:{kind:'candlestick',title:'OHLC',yScale:'auto',height:'lg',yLabel:'INR',series:{records:'{/bars}',label:'date',fields:['open','high','low','close']}}}];
  const store=new SurfaceStore(basicCatalog);assert.deepEqual(store.render({surface:'valid',data,nodes}),[]);
  for(const row of [{...data.bars[0],high:101},{...data.bars[0],low:111}]){
    const s=new SurfaceStore(basicCatalog);assert.ok(s.render({surface:'invalid',data:{bars:[row]},nodes}).some(d=>d.severity==='error'));
  }
  const s=new SurfaceStore(basicCatalog);assert.ok(s.render({surface:'invalid',nodes:[{id:'root',type:'chart',props:{kind:'candlestick',labels:['A'],series:[{values:[1]},{values:[2]},{values:[0]}]}}]}).some(d=>d.severity==='error'));
});
