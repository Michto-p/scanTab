import { validateQuad } from '../pretraitement/geometry.js';

// Ce détecteur cherche des contours en deux dimensions. Il ne déduit ni la
// hauteur d'une façade à partir de 18 mm, ni la nature électrique d'un rectangle.
const MAX_SIDE = 1000;
const DEG = Math.PI / 180;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const angleDifference = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function empty(reason) {
  return { candidates: [], orientation: null, warnings: [reason], reason };
}

function preview(source, requestedBounds) {
  const { width, height, data } = source ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 24 || height < 24 || !data || data.length !== width * height * 4) return null;
  const bounds = requestedBounds ?? { x: 0, y: 0, width, height };
  if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) || bounds.x < 0 || bounds.y < 0 || bounds.width < 24 || bounds.height < 24 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) return null;
  const ratio = Math.min(1, MAX_SIDE / Math.max(bounds.width, bounds.height));
  const w = Math.round(bounds.width * ratio), h = Math.round(bounds.height * ratio);
  const raw = new Float32Array(w * h), pixels = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(width - 1, Math.floor(bounds.x + (x + .5) * bounds.width / w));
    const sy = Math.min(height - 1, Math.floor(bounds.y + (y + .5) * bounds.height / h));
    const index = (sy * width + sx) * 4, alpha = data[index + 3] / 255;
    raw[y * w + x] = alpha * (.2126 * data[index] + .7152 * data[index + 1] + .0722 * data[index + 2]) + (1 - alpha) * 255;
  }
  pixels.set(raw);
  // Lissage léger : les petits artefacts JPEG ne doivent pas devenir des côtés.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += raw[(y + dy) * w + x + dx];
    pixels[y * w + x] = sum / 9;
  }
  return { width: w, height: h, pixels, bounds, scaleX: bounds.width / w, scaleY: bounds.height / h };
}

function gradients(image) {
  const { width, height, pixels } = image;
  const gx = new Float32Array(pixels.length), gy = new Float32Array(pixels.length), magnitude = new Float32Array(pixels.length);
  const points = [];
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const index = y * width + x;
    const dx = pixels[index + 1] - pixels[index - 1], dy = pixels[index + width] - pixels[index - width];
    const strength = Math.hypot(dx, dy);
    gx[index] = dx; gy[index] = dy; magnitude[index] = strength;
    if (strength >= 12) points.push({ x, y, strength: Math.min(80, strength), angle: (Math.atan2(dy, dx) + Math.PI) % Math.PI });
  }
  return { gx, gy, magnitude, points };
}

function sampleEdge(point, normal, image, gradient, radius = 2, threshold = 12) {
  let best = 0;
  for (let shift = -radius; shift <= radius; shift++) {
    const x = Math.round(point.x + normal.x * shift), y = Math.round(point.y + normal.y * shift);
    if (x < 2 || y < 2 || x >= image.width - 2 || y >= image.height - 2) continue;
    const index = y * image.width + x, strength = gradient.magnitude[index];
    // Une texture croisant le côté ne constitue pas un bord parallèle au côté.
    const projected = Math.abs(gradient.gx[index] * normal.x + gradient.gy[index] * normal.y);
    if (strength >= threshold && projected >= strength * .82) best = Math.max(best, projected);
  }
  return best;
}

function edgePoint(point, normal, image, gradient, radius = 1, threshold = 12) {
  let result = null;
  for (let shift = -radius; shift <= radius; shift++) {
    const x = Math.round(point.x + normal.x * shift), y = Math.round(point.y + normal.y * shift);
    if (x < 2 || y < 2 || x >= image.width - 2 || y >= image.height - 2) continue;
    const index = y * image.width + x, strength = gradient.magnitude[index];
    const weight = Math.abs(gradient.gx[index] * normal.x + gradient.gy[index] * normal.y);
    if (strength >= threshold && weight >= strength * .82 && (!result || weight > result.weight)) result = { x, y, weight };
  }
  return result;
}

function fittedSegment(run, normal, tangent, score) {
  const total = run.reduce((sum, item) => sum + item.weight, 0);
  const center = run.reduce((point, item) => ({ x: point.x + item.x * item.weight / total, y: point.y + item.y * item.weight / total }), { x: 0, y: 0 });
  let numerator = 0, denominator = 0;
  for (const point of run) {
    const delta = { x: point.x - center.x, y: point.y - center.y }, t = dot(delta, tangent), n = dot(delta, normal);
    numerator += point.weight * t * n; denominator += point.weight * t * t;
  }
  const slope = denominator ? numerator / denominator : 0, norm = Math.hypot(1, slope);
  normal = { x: (normal.x - slope * tangent.x) / norm, y: (normal.y - slope * tangent.y) / norm };
  tangent = { x: -normal.y, y: normal.x };
  const positions = run.map(point => dot(point, tangent)), start = Math.min(...positions), end = Math.max(...positions), rho = dot(center, normal);
  const endpoints = [start, end].map(t => ({ x: normal.x * rho + tangent.x * t, y: normal.y * rho + tangent.y * t }));
  return { normal, tangent, rho, start, end, length: end - start, score, endpoints };
}

function segments(image, gradient) {
  const diagonal = Math.ceil(Math.hypot(image.width, image.height)), bins = diagonal * 2 + 1, angles = 90;
  const votes = new Float32Array(angles * bins);
  const normals = Array.from({ length: angles }, (_, index) => ({ x: Math.cos(index * 2 * DEG), y: Math.sin(index * 2 * DEG) }));
  for (const point of gradient.points) {
    const center = Math.round(point.angle / (2 * DEG)) % angles;
    for (let shift = -3; shift <= 3; shift++) {
      const angle = (center + shift + angles) % angles, normal = normals[angle];
      const bin = Math.round(point.x * normal.x + point.y * normal.y) + diagonal;
      votes[angle * bins + bin] += point.strength;
    }
  }
  const peaks = [];
  const minimum = Math.max(12, Math.min(image.width, image.height) * .022);
  for (let angle = 0; angle < angles; angle++) for (let bin = 1; bin < bins - 1; bin++) {
    const value = votes[angle * bins + bin];
    if (value >= minimum * 12 && value >= votes[angle * bins + bin - 1] && value >= votes[angle * bins + bin + 1]) peaks.push({ angle, rho: bin - diagonal, value });
  }
  peaks.sort((a, b) => b.value - a.value);
  const lines = [];
  for (const peak of peaks.slice(0, 700)) {
    const normal = normals[peak.angle], tangent = { x: -normal.y, y: normal.x };
    const base = { x: normal.x * peak.rho, y: normal.y * peak.rho };
    const projections = [{ x: 2, y: 2 }, { x: image.width - 3, y: 2 }, { x: image.width - 3, y: image.height - 3 }, { x: 2, y: image.height - 3 }].map(point => dot(point, tangent));
    let first = null, last = null, hits = [];
    const runs = [];
    const finish = () => {
      if (first !== null && last - first >= minimum && hits.length / (last - first + 1) >= .65) runs.push(hits);
      first = null; last = null; hits = [];
    };
    for (let t = Math.floor(Math.min(...projections)); t <= Math.ceil(Math.max(...projections)); t++) {
      const point = { x: base.x + tangent.x * t, y: base.y + tangent.y * t };
      const hit = edgePoint(point, normal, image, gradient);
      if (hit) {
        if (first === null) first = t;
        last = t; hits.push({ t, ...hit });
      } else if (last !== null && t - last > 4) finish();
    }
    finish();
    for (const run of runs) {
      const fitted = fittedSegment(run, normal, tangent, peak.value), [start, end] = fitted.endpoints;
      if (lines.some(line => Math.abs(dot(start, line.normal) - line.rho) < 3 && Math.abs(dot(end, line.normal) - line.rho) < 3 && Math.min(line.end, Math.max(dot(start, line.tangent), dot(end, line.tangent))) >= Math.max(line.start, Math.min(dot(start, line.tangent), dot(end, line.tangent))) - 4 && angleDifference(Math.atan2(normal.y, normal.x), Math.atan2(line.normal.y, line.normal.x)) < 7 * DEG)) continue;
      lines.push(fitted);
    }
    if (lines.length >= 420) break;
  }
  // Les longues arêtes du coffret ne doivent pas évincer tous les joints courts.
  // Le quota est local, réparti dans l'image, et indépendant d'une rangée connue.
  const cells = new Map();
  for (const line of lines.sort((a, b) => b.length - a.length)) {
    const center = { x: (line.endpoints[0].x + line.endpoints[1].x) / 2, y: (line.endpoints[0].y + line.endpoints[1].y) / 2 };
    const key = `${Math.floor(center.x / image.width * 6)}:${Math.floor(center.y / image.height * 6)}:${Math.abs(line.tangent.x) > Math.abs(line.tangent.y) ? 'h' : 'v'}`;
    const cell = cells.get(key) ?? [];
    if (cell.length < 5) cell.push(line);
    cells.set(key, cell);
  }
  return mergeAligned([...cells.values()].flat());
}

function mergeAligned(lines) {
  const merged = [...lines];
  for (let i = 0; i < merged.length; i++) for (let j = i + 1; j < merged.length; j++) {
    const a = merged[i], b = merged[j];
    if (Math.abs(a.normal.x * b.normal.x + a.normal.y * b.normal.y) < .998 || b.endpoints.some(point => Math.abs(dot(point, a.normal) - a.rho) > 3)) continue;
    const positions = b.endpoints.map(point => dot(point, a.tangent)), low = Math.min(...positions), high = Math.max(...positions);
    const start = Math.min(a.start, low), end = Math.max(a.end, high), gap = Math.max(0, Math.max(a.start, low) - Math.min(a.end, high));
    if (gap > Math.max(5, (end - start) * .23)) continue;
    merged[i] = { ...a, start, end, length: end - start, endpoints: [start, end].map(t => ({ x: a.normal.x * a.rho + a.tangent.x * t, y: a.normal.y * a.rho + a.tangent.y * t })) };
    merged.splice(j--, 1);
  }
  return merged;
}

function intersection(a, b) {
  const determinant = a.normal.x * b.normal.y - a.normal.y * b.normal.x;
  if (Math.abs(determinant) < .25) return null;
  return { x: (a.rho * b.normal.y - a.normal.y * b.rho) / determinant, y: (a.normal.x * b.rho - a.rho * b.normal.x) / determinant };
}

function reaches(line, point, margin = 4) {
  const t = dot(point, line.tangent);
  return t >= line.start - margin && t <= line.end + margin;
}

function sideSupport(a, b, image, gradient, threshold = 12, radiusOverride = null) {
  const length = distance(a, b), normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const count = Math.max(12, Math.round(length)), start = Math.max(1, Math.floor(count * .035));
  let hits = 0, gap = 0, longestGap = 0, sum = 0, firstHits = 0, lastHits = 0, firstSamples = 0, lastSamples = 0;
  for (let step = start; step <= count - start; step++) {
    const radius = radiusOverride ?? Math.min(5, Math.max(2, Math.ceil(length * .009)));
    const t = step / count, strength = sampleEdge({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, normal, image, gradient, radius, threshold);
    if (strength >= threshold) { hits++; gap = 0; sum += Math.min(100, strength); }
    else { gap++; longestGap = Math.max(longestGap, gap); }
    if (step <= count * .2) { firstSamples++; if (strength >= threshold) firstHits++; }
    if (step >= count * .8) { lastSamples++; if (strength >= threshold) lastHits++; }
  }
  const samples = count - start * 2 + 1;
  return { coverage: hits / samples, longestGap: longestGap / samples, strength: sum / Math.max(1, hits), first: firstHits / Math.max(1, firstSamples), last: lastHits / Math.max(1, lastSamples) };
}

function persistentSides(top, bottom, image, gradient) {
  // Des joints faibles derrière un plastron peuvent être interrompus par les
  // leviers. Ils doivent se répéter dans la même fenêtre de deux vrais bords.
  // La recherche reste en pixels et ne pose aucune grille modulaire uniforme.
  const minimumSpan = Math.max(60, image.width * .15);
  if (top.length < minimumSpan || bottom.length < minimumSpan) return [];
  let low = Math.max(Math.min(...top.endpoints.map(point => point.x)), Math.min(...bottom.endpoints.map(point => point.x)));
  let high = Math.min(Math.max(...top.endpoints.map(point => point.x)), Math.max(...bottom.endpoints.map(point => point.x)));
  if (high - low < 60) return [];
  const yTop = x => (top.rho - top.normal.x * x) / top.normal.y, yBottom = x => (bottom.rho - bottom.normal.x * x) / bottom.normal.y;
  const middleX = (low + high) / 2, depth = yBottom(middleX) - yTop(middleX);
  if (depth < 16) return [];
  const extension = Math.min(25, Math.max(7, depth * .08));
  low = Math.max(2, low - extension); high = Math.min(image.width - 3, high + extension);
  const slope = -(top.normal.x / top.normal.y + bottom.normal.x / bottom.normal.y) / 2;
  const vertical = { x: -slope / Math.hypot(1, slope), y: 1 / Math.hypot(1, slope) };
  const normal = { x: vertical.y, y: -vertical.x }, positions = [];
  for (let x = Math.ceil(low); x <= Math.floor(high); x++) {
    const middle = { x, y: (yTop(x) + yBottom(x)) / 2 }, line = { normal, tangent: vertical, rho: dot(middle, normal) };
    const p0 = intersection(top, line), p1 = intersection(bottom, line);
    if (!p0 || !p1) continue;
    const support = sideSupport(p0, p1, image, gradient, 7, 1);
    if (support.coverage >= .57 && support.longestGap <= .28 && support.first >= .6 && support.last >= .6) positions.push({ line, p0, p1, middle, support });
  }
  const clusters = [];
  for (const item of positions) {
    let cluster = clusters.at(-1);
    if (!cluster || item.middle.x - cluster.at(-1).middle.x > 1.5) { cluster = []; clusters.push(cluster); }
    cluster.push(item);
  }
  const sides = [];
  for(const cluster of clusters.filter(cluster => cluster.length <= Math.max(8, depth * .16))){
    const candidate=cluster.sort((a,b)=>(b.support.coverage+b.support.strength*.005)-(a.support.coverage+a.support.strength*.005))[0],run=[];
    const count=Math.max(12,Math.round(distance(candidate.p0,candidate.p1)/2));
    for(let i=1;i<count;i++){
      const t=i/count,point={x:candidate.p0.x+(candidate.p1.x-candidate.p0.x)*t,y:candidate.p0.y+(candidate.p1.y-candidate.p0.y)*t};
      const hit=edgePoint(point,normal,image,gradient,3,7);if(hit)run.push(hit);
    }
    if(run.length<8)continue;
    const proposals=[candidate.line,fittedSegment(run,normal,vertical,0)];
    const anchorRadius=Math.min(5,Math.max(2,Math.ceil(depth*.02)));
    const firstAnchor=edgePoint({x:candidate.p0.x+vertical.x*2,y:candidate.p0.y+vertical.y*2},normal,image,gradient,anchorRadius,7);
    const lastAnchor=edgePoint({x:candidate.p1.x-vertical.x*2,y:candidate.p1.y-vertical.y*2},normal,image,gradient,anchorRadius,7);
    if(firstAnchor&&lastAnchor){
      const length=distance(firstAnchor,lastAnchor),n={x:(lastAnchor.y-firstAnchor.y)/length,y:-(lastAnchor.x-firstAnchor.x)/length};
      proposals.push({normal:n,tangent:{x:-n.y,y:n.x},rho:dot(firstAnchor,n)});
    }
    // La direction d'un joint ne dépend pas de celle du bandeau supérieur.
    // Quelques directions voisines sont vérifiées dans les pixels, plutôt
    // qu'imposer leur parallélisme dans une photo en perspective.
    for(const tilt of [-.04,-.02,.02,.04])for(const shift of [-2,0,2]){
      const n={x:normal.x+tilt*vertical.x,y:normal.y+tilt*vertical.y},norm=Math.hypot(n.x,n.y);n.x/=norm;n.y/=norm;
      proposals.push({normal:n,tangent:{x:-n.y,y:n.x},rho:dot({x:candidate.middle.x+shift,y:candidate.middle.y},n)});
    }
    let best=null;
    for(const line of proposals){
      const p0=intersection(top,line),p1=intersection(bottom,line);if(!p0||!p1)continue;
      const support=sideSupport(p0,p1,image,gradient,7),length=distance(p0,p1),along={x:(p1.x-p0.x)/length,y:(p1.y-p0.y)/length};
      const first=sampleEdge({x:p0.x+along.x*2,y:p0.y+along.y*2},line.normal,image,gradient,anchorRadius,7);
      let last=0;
      // Une lèvre plastique commune peut masquer les derniers pixels du joint.
      // L'extrémité reste exigée dans une petite zone proche du bord observé.
      for(let offset=2;offset<=Math.min(8,length*.06);offset+=2)last=Math.max(last,sampleEdge({x:p1.x-along.x*offset,y:p1.y-along.y*offset},line.normal,image,gradient,anchorRadius,7));
      // Aux jonctions, le gradient du bord horizontal peut masquer la normale
      // du joint. Une arête presque continue fournit alors une autre preuve ;
      // une petite ligne de texte interrompue ne satisfait pas ce contrôle.
      const firstConfirmed=first>=7||(support.coverage>=.82&&support.longestGap<=.12&&support.first>=.85);
      const lastConfirmed=last>=7||(support.coverage>=.8&&support.longestGap<=.18&&support.last>=.85);
      if(support.coverage<.57||support.longestGap>.28||support.first<.6||support.last<.6||!firstConfirmed||!lastConfirmed)continue;
      const score=support.coverage+support.strength*.0001;
      if(!best||score>best.score)best={line,p0,p1,middle:{x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2},support,score};
    }
    if(best)sides.push(best);
  }
  return sides.length >= 4 ? sides : [];
}

function area(points) {
  return points.reduce((sum, point, index) => { const next = points[(index + 1) % 4]; return sum + point.x * next.y - point.y * next.x; }, 0) / 2;
}

function quadCandidates(image, gradient, lines) {
  // Deux familles de côtés sont recherchées ; leur angle n'est pas supposé nul.
  // Les pentes des deux bords opposés peuvent diverger avec la perspective.
  const horizontal = lines.filter(line => Math.abs(line.tangent.x) >= .65).sort((a, b) => b.length - a.length).slice(0, 120);
  const vertical = lines.filter(line => Math.abs(line.tangent.y) >= .65).sort((a, b) => b.length - a.length).slice(0, 160);
  const result = [];
  for (let h = 0; h < horizontal.length - 1; h++) for (let j = h + 1; j < horizontal.length; j++) {
    let top = horizontal[h], bottom = horizontal[j];
    const hAngle = line => Math.atan2(-line.normal.x / line.normal.y, 1);
    if (Math.abs(hAngle(top) - hAngle(bottom)) > 22 * DEG) continue;
    const middleX = image.width / 2;
    if ((top.rho - top.normal.x * middleX) / top.normal.y > (bottom.rho - bottom.normal.x * middleX) / bottom.normal.y) [top, bottom] = [bottom, top];
    const meanAngle = (hAngle(top) + hAngle(bottom)) / 2;
    const sides = [];
    for (const side of vertical) {
      const p0 = intersection(top, side), p1 = intersection(bottom, side);
      if (!p0 || !p1 || p1.y - p0.y < 12 || !reaches(side, p0, distance(p0, p1) * .23) || !reaches(side, p1, distance(p0, p1) * .23) || !reaches(top, p0, Math.min(25,Math.max(7,distance(p0,p1)*.08))) || !reaches(bottom, p1, Math.min(25,Math.max(7,distance(p0,p1)*.08)))) continue;
      const verticalAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      if (Math.abs(verticalAngle - meanAngle - Math.PI / 2) > 30 * DEG) continue;
      const support = sideSupport(p0, p1, image, gradient);
      if (support.coverage < .75 || support.longestGap > .2 || support.first < .65 || support.last < .65) continue;
      const middle = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      if (sides.some(item => distance(item.middle, middle) < 4)) continue;
      sides.push({ line: side, p0, p1, middle, support });
    }
    if (sides.length >= 2 && (sides.length < 4 || (top.length > image.width * .5 && bottom.length > image.width * .5))) for (const side of persistentSides(top, bottom, image, gradient)) if (!sides.some(item => distance(item.middle, side.middle) < Math.max(4,distance(side.p0,side.p1)*.035))) sides.push(side);
    sides.sort((a, b) => a.middle.x - b.middle.x);
    // Les côtés réellement continus découpent les cellules. Aucun trait n'est
    // ajouté au pas de 18 mm : une façade large sans joint reste entière.
    for (let index = 0; index < sides.length - 1; index++) {
      const left = sides[index], right = sides[index + 1], points = [left.p0, right.p0, right.p1, left.p1];
      if (!validateQuad(points, image.width, image.height) || distance(points[0], points[1]) < 10 || distance(points[2], points[3]) < 10 || area(points) < 180) continue;
      const supports = [sideSupport(points[0], points[1], image, gradient), right.support, sideSupport(points[2], points[3], image, gradient), left.support];
      if (supports[0].coverage < .75 || supports[2].coverage < .75 || [supports[1], supports[3]].some(support => support.coverage < .57 || support.longestGap > .28)) continue;
      if (result.some(candidate => candidate.points.every((point, i) => distance(point, points[i]) < 5))) continue;
      const coverage = supports.map(support => support.coverage);
      result.push({ points, area: area(points), supports, lineEvidence:top.length+bottom.length, score: Math.min(.94, .5 + Math.min(...coverage) * .3 + coverage.reduce((sum, value) => sum + value, 0) / 4 * .14) });
    }
  }
  return result;
}

function inside(point, points, margin = 3) {
  return points.every((a, i) => {
    const b = points[(i + 1) % 4];
    return ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) >= -margin * distance(a, b);
  });
}

function overlap(a, b) {
  const ac = a.points.reduce((point, item) => ({ x: point.x + item.x / 4, y: point.y + item.y / 4 }), { x: 0, y: 0 });
  const bc = b.points.reduce((point, item) => ({ x: point.x + item.x / 4, y: point.y + item.y / 4 }), { x: 0, y: 0 });
  return inside(ac, b.points, 0) || inside(bc, a.points, 0);
}

function maximalFaces(candidates) {
  const sorted = [...candidates].sort((a, b) => {
    // Deux tracés presque identiques peuvent suivre les deux flancs d'un trait
    // épais. Privilégier celui qui rejoint les segments effectivement observés
    // sur le plus de longueur, plutôt qu'un coin extrapolé légèrement plus loin.
    if(Math.min(a.area,b.area)/Math.max(a.area,b.area)>.95&&overlap(a,b)&&Math.abs(a.lineEvidence-b.lineEvidence)>10)return b.lineEvidence-a.lineEvidence;
    return b.area-a.area;
  }), selected = [];
  for (const candidate of sorted) {
    // Un grand contour entourant plusieurs cellules de hauteur comparable est
    // probablement un contenant. À l'inverse, un petit cadre imprimé inclus
    // dans une cellule complète ne remplace pas son contour extérieur.
    const children = [];
    for (const other of sorted) {
      if (other.area >= candidate.area * .85 || !other.points.every(point => inside(point, candidate.points)) || children.some(child => overlap(other, child))) continue;
      children.push(other);
    }
    const height = (distance(candidate.points[0], candidate.points[3]) + distance(candidate.points[1], candidate.points[2])) / 2;
    const substantial = children.filter(child => (distance(child.points[0], child.points[3]) + distance(child.points[1], child.points[2])) / 2 >= height * .45);
    if (substantial.length >= 2) continue;
    const repeated = children.filter(child => (distance(child.points[0], child.points[3]) + distance(child.points[1], child.points[2])) / 2 >= height * .25);
    if (repeated.length >= 3) continue;
    if (selected.some(outer => candidate.points.every(point => inside(point, outer.points)))) continue;
    if (selected.some(other => overlap(candidate, other))) continue;
    selected.push(candidate);
  }
  return selected;
}

function rejectDarkJoints(candidates, image) {
  const stats = candidates.map(candidate => {
    const values = [];
    for (let y = 1; y <= 7; y++) for (let x = 1; x <= 7; x++) {
      const u = .1 + x / 8 * .8, v = .1 + y / 8 * .8, [a,b,c,d] = candidate.points;
      const px = (1-v)*((1-u)*a.x+u*b.x)+v*((1-u)*d.x+u*c.x), py = (1-v)*((1-u)*a.y+u*b.y)+v*((1-u)*d.y+u*c.y);
      values.push(image.pixels[clamp(Math.round(py),0,image.height-1)*image.width+clamp(Math.round(px),0,image.width-1)]);
    }
    const mean = values.reduce((sum,value)=>sum+value,0)/values.length;
    return { candidate, mean, deviation: Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length), width:(distance(candidate.points[0],candidate.points[1])+distance(candidate.points[2],candidate.points[3]))/2 };
  });
  return stats.filter(item => {
    if (item.mean >= 80 || item.deviation >= 5) return true;
    const middle = item.candidate.points.reduce((point,p)=>({x:point.x+p.x/4,y:point.y+p.y/4}),{x:0,y:0});
    // Deux bords d'un même joint noir épais ne constituent pas une façade.
    // Un rectangle sombre isolé reste proposé comme inconnu ; seule la bande
    // uniforme étroite, encadrée par deux vraies surfaces, est retirée ici.
    const neighbors = stats.filter(other => other !== item && other.width > item.width * 5 && other.mean > item.mean + 40 && Math.abs((other.candidate.points[0].y+other.candidate.points[2].y)/2-middle.y) < Math.abs(item.candidate.points[2].y-item.candidate.points[0].y)*.15);
    return !(neighbors.some(other=>other.candidate.points[1].x<=middle.x+2)&&neighbors.some(other=>other.candidate.points[0].x>=middle.x-2));
  }).map(item=>item.candidate);
}

/**
 * Contours proposés de façades, dans la photo originale (HG, HD, BD, BG).
 * Le score concerne les quatre bords, jamais une identification électrique.
 * Une ROI facultative est extraite avant réduction et ne modifie pas la source.
 */
export function detectFacades(imageData, { bounds } = {}) {
  const image = preview(imageData, bounds);
  if (!image) return empty('Image ou zone invalide : les contours de façade restent inconnus.');
  const gradient = gradients(image);
  if (!gradient.points.length) return empty('Aucun contour suffisamment contrasté : les façades restent inconnues.');
  const found = rejectDarkJoints(maximalFaces(quadCandidates(image, gradient, segments(image, gradient))), image);
  if (!found.length) return empty('Les quatre côtés complets des façades ne sont pas suffisamment visibles.');
  const candidates = found.map(candidate => {
    const points = candidate.points.map(point => ({ x: image.bounds.x + point.x * image.scaleX, y: image.bounds.y + point.y * image.scaleY }));
    const edgeSupport = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((name, index) => [name, candidate.supports[index].coverage]));
    return {
      points, left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)), top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)),
      confiance: candidate.score, confidence: candidate.score, niveau: 'geometrie', modules: null, edgeSupport,
      reason: 'Quatre côtés visibles ; nature de l’appareil et largeur modulaire inconnues.',
      status: 'proposition', famille: 'inconnu'
    };
  }).sort((a, b) => a.top - b.top || a.left - b.left).map((candidate, index) => ({ id: `facade-${index + 1}`, ...candidate }));
  const angles = candidates.map(candidate => Math.atan2(candidate.points[1].y - candidate.points[0].y, candidate.points[1].x - candidate.points[0].x)).sort((a, b) => a - b);
  return {
    candidates, orientation: angles[Math.floor(angles.length / 2)] / DEG,
    warnings: ['Propositions de contours à vérifier : un rectangle seul ne prouve pas la présence d’un appareil électrique.'],
    reason: 'Contours soutenus indépendamment sur les quatre côtés ; aucune hauteur physique imposée.'
  };
}
