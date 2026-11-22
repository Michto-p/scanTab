const EPS = 1e-8;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
function convex(points) {
  if (!Array.isArray(points) || points.length!==4 || !points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))) return false;
  const turns=points.map((a,i)=>{const b=points[(i+1)%4],c=points[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
  // Ordre attendu : haut gauche, haut droit, bas droit, bas gauche.
  return turns.every(v=>v>EPS);
}
export function validateQuad(points,width,height) {
  return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&convex(points)&&points.every((p,i)=>p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height&&distance(p,points[(i+1)%4])>=2);
}
export function rectifiedSize(points) {
  if (!convex(points)) throw Error('Les quatre coins doivent suivre le contour du tableau sans se croiser.');
  return {width:Math.max(1,Math.round(Math.max(distance(points[0],points[1]),distance(points[3],points[2])))),height:Math.max(1,Math.round(Math.max(distance(points[0],points[3]),distance(points[1],points[2]))))};
}
function solve(matrix,values) {
  const rows=matrix.map((r,i)=>[...r,values[i]]), n=values.length;
  for (let col=0;col<n;col++) {
    let pivot=col;
    for (let r=col+1;r<n;r++) if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col])) pivot=r;
    if(Math.abs(rows[pivot][col])<EPS) throw Error('Redressement impossible avec ces coins.');
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
    const divisor=rows[col][col];
    for(let k=col;k<=n;k++) rows[col][k]/=divisor;
    for(let r=0;r<n;r++) if(r!==col){const factor=rows[r][col];for(let k=col;k<=n;k++)rows[r][k]-=factor*rows[col][k];}
  }
  return rows.map(r=>r[n]);
}
export function homography(points,width,height) {
  if(!convex(points)||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) throw Error('Coins ou dimensions invalides.');
  const matrix=[],values=[];
  [[0,0],[width,0],[width,height],[0,height]].forEach(([x,y],i)=>{const s=points[i];matrix.push([x,y,1,0,0,0,-s.x*x,-s.x*y],[0,0,0,x,y,1,-s.y*x,-s.y*y]);values.push(s.x,s.y);});
  return [...solve(matrix,values),1];
}
export function mapPoint(m,x,y) { const d=m[6]*x+m[7]*y+m[8];return {x:(m[0]*x+m[1]*y+m[2])/d,y:(m[3]*x+m[4]*y+m[5])/d}; }
export function snapHalfModule(value) { if(!Number.isFinite(value))throw Error('Nombre de modules invalide.');return Math.round(value*2)/2; }
