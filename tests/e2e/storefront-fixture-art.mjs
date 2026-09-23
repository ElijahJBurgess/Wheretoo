// Synthetic proof art only. Border labels expose flyer cropping at every viewport.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
const dir='.superpowers/storefront/screenshots';await mkdir(dir,{recursive:true})
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:400,height:500},deviceScaleFactor:1})
for(const [name,color,title] of [['flyer','#3a205e','AFTER HOURS'],['logo','#292339','NS'],['merch','#433a2e','NIGHT SESSIONS']]){
 await page.setContent(`<html><body style="margin:0;background:${color};color:#f1e8d5;font-family:Arial;height:500px;box-sizing:border-box;border:12px solid #f1e8d5;display:flex;align-items:center;justify-content:space-between;flex-direction:column;padding:20px"><div style="letter-spacing:5px">TOP • LOCAL TEST</div><div style="font-size:52px;font-weight:900;text-align:center;line-height:.95">${title}</div><div style="font-size:22px;text-align:center">MUSIC · COMMUNITY<br>OAKLAND<br><br>ALL ARTWORK VISIBLE</div><div style="letter-spacing:4px">BOTTOM • 4:5</div></body></html>`)
 await page.screenshot({path:`${dir}/${name}.png`})
}
await browser.close()
