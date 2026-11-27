import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedLinkUrl, destinationPage, linkRectangle } from "./links.ts";
test("annotation URL allowlist", () => {
  for (const url of ["https://example.com/a?q=1#b", "http://example.com", "mailto:test@example.com", "HTTPS://example.com"]) assert.equal(allowedLinkUrl(url), true, url);
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,test", "app:run", "ftp://example.com", "//example.com", " https://example.com", "java\nscript:alert(1)", "https://", "https://a\u0000b", null]) assert.equal(allowedLinkUrl(url), false, String(url));
});
test("destinations resolve indexes, references and names; invalid destinations do not navigate", async () => {
 const pdf = {numPages:2,getDestination:async()=>[{num:4,gen:0}],getPageIndex:async()=>1};
 for(const dest of [[1], [{num:4,gen:0}], "chapter"]) assert.equal(await destinationPage(dest,pdf),2);
 for(const dest of [[-1],[2],null,[],[{}]]) assert.equal(await destinationPage(dest,pdf),null);
});
test("rectangles normalize rotation and remain proportional at every scale",()=>{
 for (const scale of [.5,1,2]) assert.deepEqual(linkRectangle([10,20,110,40],{width:200*scale,height:400*scale,convertToViewportRectangle:r=>r.map(x=>x*scale)}),{left:5,top:5,width:50,height:5});
 assert.deepEqual(linkRectangle([10,20,110,40],{width:400,height:200,convertToViewportRectangle:()=>[40,110,20,10]}),{left:5,top:5,width:5,height:50});
 assert.equal(linkRectangle([0,0,NaN,2],{width:1,height:1,convertToViewportRectangle:r=>r}),null);
});
