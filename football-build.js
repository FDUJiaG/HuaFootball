#!/usr/bin/env node

/**
 * HuaFootball Build Script v3.1
 * =================================
 * Scans WorldCup2026/ for team reports, extracts OPR scores & ratings,
 * and updates the teams-data JSON block in index.html.
 *
 * Usage: node football-build.js
 *
 * After adding a new team report to WorldCup2026/:
 *   node football-build.js
 *
 * The index.html template is preserved — only the team data is updated.
 *
 * ✨ Hero区浮动国旗：由 index.html 中的 JS 从 teams-data 动态渲染
 *    前四名国旗，无需 build 脚本单独维护。
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const INDEX_PATH = path.join(ROOT, 'index.html');
const TEAMS_DIR = path.join(ROOT, 'WorldCup2026');

const FLAG_FALLBACK = '🏳️';
const COLOR_FALLBACK = '#6b7280';

// ─── Load config ──────────────────────────────────────────────────
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch { /* ignore */ }

const FC = config.football || {};
const TEAM_FLAGS = FC.teamFlags || {};
const TEAM_COLORS = FC.teamColors || {};
const TEAM_FLAG_IMAGES = FC.flagImages || {};

// ─── Extract score from report HTML ───────────────────────────────
function extractScore(content) {
  // 1. "加权总分：42.0 / 100"
  let m = content.match(/加权总分[：:]\s*([\d.]+)\s*\/\s*100/);
  if (m) return parseFloat(m[1]);

  // 2. "加权总分计算：... = 82.5分"
  m = content.match(/加权总分计算[^=]*=\s*<strong>([\d.]+)\s*分/);
  if (m) return parseFloat(m[1]);

  // 3. "加权总分" label + nearby number (法国格式: <p>87.4</p> right after)
  m = content.match(/加权总分<\/p>\s*\n?\s*<p[^>]*>([\d.]+)/);
  if (m) return parseFloat(m[1]);

  // 3b. "加权总分" in div + nearby number in div (英格兰格式: <div>加权总分</div><div>79.5</div>)
  m = content.match(/加权总分<\/div>\s*\n?\s*<div[^>]*>\s*([\d.]+)/);
  if (m) return parseFloat(m[1]);

  // 4. <div class="total-score">79.25 / 100</div> or <div class="total-score">64.85分</div>
  m = content.match(/<div\s+class="[^"]*\btotal-score\b[^"]*"[^>]*>\s*([\d.]+)\s*(?:\/|\u5206)/);
  if (m) return parseFloat(m[1]);

  // 5. <div class="score">82.5 分</div> — but NOT dimension-score
  m = content.match(/<div\s+class="[^"]*(?<!dimension-)score\b[^"]*"[^>]*>\s*([\d.]+)\s*\u5206/);
  if (m) return parseFloat(m[1]);

  // 6. Table cell: "加权总分" row → <td><strong>64.85 / 100</strong></td>
  m = content.match(/加权总分[^<]*<td[^>]*>[^<]*<strong>([\d.]+)\s*\/\s*100/);
  if (m) return parseFloat(m[1]);

  // 7. <div class="score">83.6</div> ... 加权总分 (rating-box 格式，数字后无"分")
  m = content.match(/<div\s+class="[^"]*\bscore\b[^"]*"[^>]*>\s*([\d.]+)\s*<\/div>[\s\S]{0,500}?加权总分/);
  if (m) return parseFloat(m[1]);

  return null;
}

// ─── Extract rating from report HTML ──────────────────────────────
function extractRating(content) {
  // 1. 实力评级：<span ...>A+</span>
  let m = content.match(/实力评级[：:][^<]*<[^>]*>([A-D][+-]?)<\/[^>]*>/);
  if (m) return m[1];

  // 2. 评级：C — 二线劲旅（韩国格式）
  m = content.match(/评级[：:]\s*([A-D][+-]?)\s*[—–]/);
  if (m) return m[1];

  // 3. A 级 / A+级 after 实力评级 or inside rating div
  m = content.match(/实力评级[：:][^，,。]*?([A-D][+-]?)\s*级/);
  if (m) return m[1];

  // 4. 法国格式: <div class="rating-A ...">A 级</div>
  m = content.match(/class="[^"]*rating-([A-D])[^"]*"[^>]*>\s*\1\s*级/);
  if (m) return m[1];

  // 5. 日本格式: <strong>A级（80-89分区间）</strong>
  m = content.match(/<strong>([A-D][+-]?)\s*级/);
  if (m) return m[1];

  // 6. rating-badge: <span class="rating-badge">B级 — 二线劲旅</span>
  m = content.match(/rating-badge[^>]*>([A-D][+-]?)\s*级/);
  if (m) return m[1];

  return null;
}

// ─── Extract 7 dimension scores from report HTML ──────────────────
function extractDimensions(content) {
  const dims = [null, null, null, null, null, null, null];
  const labels = ['一','二','三','四','五','六','七'];

  // Strategy 1: <h3>维度X：...｜ 得分：... (PT/Tailwind/France formats)
  for (let i = 0; i < 7; i++) {
    const dl = labels[i];
    // 1a: 得分：SCORE分 × (PT format)
    let re = new RegExp('维度' + dl + '：[^|｜]*[｜|] *得分[：:] *([\\d.]+) *分 *×', 'i');
    let m = content.match(re);
    if (m) { dims[i] = parseFloat(m[1]); continue; }

    // 1b: 得分：<span>SCORE</span> × (France format)
    re = new RegExp('维度' + dl + '：[^|｜]*[｜|] *得分[：:] *<[^>]+>([\\d.]+)</[^>]+> *×', 'i');
    m = content.match(re);
    if (m) { dims[i] = parseFloat(m[1]); continue; }

    // 1c: ｜ SCORE分 × (without "得分：" prefix)
    re = new RegExp('维度' + dl + '：[^|｜]*[｜|] *([\\d.]+) *分 *×', 'i');
    m = content.match(re);
    if (m) { dims[i] = parseFloat(m[1]); continue; }

    // 1d: 维度X总评：<strong>SCORE分</strong>
    re = new RegExp('维度' + dl + '总评[：:][^<]*<strong>([\\d.]+) *分', 'i');
    m = content.match(re);
    if (m) { dims[i] = parseFloat(m[1]); continue; }
  }

  // Strategy 2: <div class="dimension-score">SCORE分 × ... (EN format)
  const allScores = content.match(/<div[^>]*class="[^"]*dimension-score[^"]*"[^>]*>\s*([\d.]+)\s*分/g);
  if (allScores && allScores.length >= 7) {
    for (let i = 0; i < 7; i++) {
      if (dims[i] != null) continue;
      const sm = allScores[i].match(/([\d.]+)\s*分/);
      if (sm) dims[i] = parseFloat(sm[1]);
    }
  }

  // Strategy 3: 维度X总评：<strong>SCORE分</strong> (fallback)
  if (dims.some(d => d == null)) {
    for (let i = 0; i < 7; i++) {
      if (dims[i] != null) continue;
      const dl = labels[i];
      const re = new RegExp('维度' + dl + '总评[：:][^<]*<strong>([\\d.]+) *分', 'i');
      const m = content.match(re);
      if (m) dims[i] = parseFloat(m[1]);
    }
  }

  return dims;
}

// ─── Compute rating from score ────────────────────────────────────
function computeRating(score) {
  if (score == null) return '?';
  if (score >= 87) return 'A+';
  if (score >= 83) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 77) return 'B+';
  if (score >= 73) return 'B';
  if (score >= 70) return 'B-';
  if (score >= 67) return 'C+';
  if (score >= 63) return 'C';
  if (score >= 60) return 'C-';
  if (score >= 50) return 'D+';
  if (score >= 40) return 'D';
  if (score >= 30) return 'D-';
  return 'E';
}

// ─── Update rating display in report HTML ─────────────────────────
function updateReportRating(absPath, oldContent, newRating) {
  let content = oldContent;
  let changed = false;

  // Pattern 1: 实力评级：<span class="...">OLD</span>（旧描述）
  let m = content.match(/(实力评级[：:][^<]*<[^>]*>)[A-D][+-]?(E)?(<\/[^>]*>)([^<]*)/);
  if (m && !changed) {
    content = content.replace(m[0], m[1] + newRating + m[3] + '（新的评级描述）');
    changed = true;
  }

  // Pattern 2: 评级：OLD — 旧描述
  if (!changed) {
    m = content.match(/(评级[：:]\s*)[A-D][+-]?(E)?(\s*[—–].*)/);
    if (m) { content = content.replace(m[0], m[1] + newRating + m[3]); changed = true; }
  }

  // Pattern 3: <div class="rating-X ...">X 级</div>
  if (!changed) {
    m = content.match(/(class="[^"]*rating-)[A-D]([^"]*"[^>]*>\s*)[A-D](\s*级<\/div>)/);
    if (m) {
      const base = newRating[0];
      content = content.replace(m[0], m[1] + base + m[2] + newRating + m[3]);
      changed = true;
    }
  }

  // Pattern 4: <strong>OLD级（日本格式）
  if (!changed) {
    m = content.match(/(<strong>)[A-D][+-]?(E)?(\s*级[^<]*<\/strong>)/);
    if (m) { content = content.replace(m[0], m[1] + newRating + m[3]); changed = true; }
  }

  // Pattern 5: rating-badge">OLD级 — 描述</span>
  if (!changed) {
    m = content.match(/(rating-badge[^>]*>)[A-D][+-]?(E)?(\s*级\s*[—–]\s*[^<]*<\/span>)/);
    if (m) { content = content.replace(m[0], m[1] + newRating + m[3]); changed = true; }
  }

  if (changed) {
    fs.writeFileSync(absPath, content, 'utf-8');
    return true;
  }
  return false;
}

// ─── Scan teams ───────────────────────────────────────────────────
function scanTeams() {
  if (!fs.existsSync(TEAMS_DIR)) {
    console.log(`⚠️  目录不存在: ${TEAMS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(TEAMS_DIR)
    .filter(f => /\.html$/i.test(f) && f !== 'index.html')
    .sort();

  const teams = [];
  for (const file of files) {
    const absPath = path.join(TEAMS_DIR, file);
    const content = fs.readFileSync(absPath, 'utf-8');
    const relPath = 'WorldCup2026/' + file;

    const score = extractScore(content);
    const name = file.replace(/-2026-world-cup-report\.html$/i, '').trim();
    const computedRating = computeRating(score);
    const rawRating = extractRating(content);
    const dims = extractDimensions(content);

    if (!name) {
      console.warn(`   ⚠️  无法识别球队名: ${file}`);
      continue;
    }

    const flag = TEAM_FLAGS[name] || FLAG_FALLBACK;
    const flagImg = TEAM_FLAG_IMAGES[name] || '';
    const accent = TEAM_COLORS[name] || COLOR_FALLBACK;

    if (!TEAM_FLAGS[name]) {
      console.warn(`   ⚠️  未知球队 "${name}"，请在 config.json 的 football.teamFlags 中添加`);
    }

    teams.push({ name, flag, flagImg, file: relPath, score, rating: computedRating, accent, rawRating, dims });
    const scoreStr = score != null ? `${score}分` : '??分';
    const logOld = rawRating ? ` (原:${rawRating})` : '';
    console.log(`   ${flag} ${name}: ${scoreStr} [${computedRating}]${logOld}`);
  }

  return teams;
}

// ─── Update index.html teams-data JSON ────────────────────────────
function updateIndexData(teams) {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('❌ index.html 不存在！');
    return false;
  }

  let html = fs.readFileSync(INDEX_PATH, 'utf-8');

  // Build new teams JSON
  const teamsData = teams.map(t => ({
    name: t.name,
    flag: t.flag,
    flagImg: t.flagImg,
    file: t.file,
    score: t.score,
    rating: t.rating,
    accent: t.accent,
    dims: t.dims,
  }));
  const teamsJSON = JSON.stringify(teamsData);

  // Find and replace the teams-data script block
  const pattern = /(<script\s+id="teams-data"\s+type="application\/json">)([\s\S]*?)(<\/script>)/;
  const oldMatch = html.match(pattern);

  if (oldMatch) {
    html = html.replace(pattern, '$1' + teamsJSON + '$3');
    fs.writeFileSync(INDEX_PATH, html, 'utf-8');
    return true;
  }

  console.error('❌ 未在 index.html 中找到 teams-data 脚本块！');
  return false;
}

// ─── Inject back button into team report ──────────────────────────
function injectBackButton(fileName) {
  const absPath = path.join(TEAMS_DIR, fileName);
  let content = fs.readFileSync(absPath, 'utf-8');
  if (content.indexOf('huafootball-back-btn') !== -1 || content.indexOf('huafuture-back-btn') !== -1) return false;

  const btnHTML =
    '\n<!-- HuaFootball: back-to-home button -->\n' +
    '<a href="../index.html" class="huafootball-back-btn" target="_self">\n' +
    '  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>\n' +
    '  返回首页\n' +
    '</a>\n' +
    '<style>\n' +
    '.huafootball-back-btn {\n' +
    '  position:fixed!important;bottom:28px!important;right:28px!important;z-index:99999!important;\n' +
    '  display:inline-flex!important;align-items:center!important;gap:6px!important;\n' +
    '  padding:10px 22px!important;background:rgba(26,71,42,0.85)!important;color:#c8a951!important;\n' +
    '  border:1px solid rgba(200,169,81,0.3)!important;border-radius:999px!important;\n' +
    '  font-family:"Inter","PingFang SC",system-ui,sans-serif!important;font-size:13px!important;\n' +
    '  font-weight:600!important;text-decoration:none!important;\n' +
    '  backdrop-filter:blur(8px)!important;-webkit-backdrop-filter:blur(8px)!important;\n' +
    '  box-shadow:0 4px 20px rgba(0,0,0,0.3)!important;transition:all .25s ease!important;\n' +
    '  cursor:pointer!important;user-select:none!important;\n' +
    '}\n' +
    '.huafootball-back-btn:hover {\n' +
    '  background:rgba(26,71,42,0.95)!important;border-color:rgba(200,169,81,0.5)!important;\n' +
    '  box-shadow:0 6px 28px rgba(200,169,81,0.2)!important;transform:translateY(-2px)!important;\n' +
    '}\n' +
    '.huafootball-back-btn svg { transition:transform .2s ease!important; }\n' +
    '.huafootball-back-btn:hover svg { transform:translateX(-3px)!important; }\n' +
    '</style>\n';

  const pos = content.lastIndexOf('</body>');
  if (pos !== -1) {
    content = content.slice(0, pos) + btnHTML + '\n' + content.slice(pos);
  } else {
    const p = content.lastIndexOf('</html>');
    if (p === -1) return false;
    content = content.slice(0, p) + btnHTML + '\n' + content.slice(p);
  }
  fs.writeFileSync(absPath, content, 'utf-8');
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────
function main() {
  console.log('⚽ HuaFootball 构建脚本 v3.1');
  console.log('━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('🔄 扫描 WorldCup2026/ 目录...');
  const teams = scanTeams();
  if (teams.length === 0) {
    console.log('\n⚠️  未找到任何球队报告');
    return;
  }

  // Sort by score desc
  teams.sort((a, b) => (b.score||0) - (a.score||0));
  console.log(`\n📊 共发现 ${teams.length} 支国家队`);

  // Update index.html team data
  console.log('\n📝 更新 index.html 球队数据...');
  if (updateIndexData(teams)) {
    console.log('   ✅ index.html 球队数据已更新');
  }

  // Inject back buttons
  console.log('\n🔗 注入返回首页按钮...');
  let injected = 0, skipped = 0;
  for (const t of teams) {
    const fn = path.basename(t.file);
    try {
      if (injectBackButton(fn)) { injected++; console.log(`   ✅ ${t.name}`); }
      else { skipped++; }
    } catch { console.warn(`   ⚠️  注入失败: ${t.name}`); }
  }

  // Update rating display in report HTML files
  console.log('\n⭐ 更新报告评级...');
  let ratingUpdated = 0, ratingSkipped = 0;
  for (const t of teams) {
    const fn = path.basename(t.file);
    const absPath = path.join(TEAMS_DIR, fn);
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      if (updateReportRating(absPath, content, t.rating)) {
        ratingUpdated++;
        console.log(`   ✅ ${t.name}: ${t.rawRating || '?'} → ${t.rating}`);
      } else {
        ratingSkipped++;
      }
    } catch { console.warn(`   ⚠️  评级更新失败: ${t.name}`); }
  }

  const scores = teams.map(t => t.score).filter(s => s != null);
  const avg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '--';
  const max = scores.length ? Math.max(...scores).toFixed(1) : '--';
  const min = scores.length ? Math.min(...scores).toFixed(1) : '--';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ 构建完成！');
  console.log(`   🏆 ${teams.length} 支国家队`);
  console.log(`   📊 平均 ${avg} | 最高 ${max} | 最低 ${min}`);
  console.log(`   🔗 返回按钮: ${injected} 份注入 (${skipped} 份已有)`);
  console.log(`   ⭐ 评级更新: ${ratingUpdated} 份 (${ratingSkipped} 份跳过)`);
  console.log('\n🌐 打开 index.html 即可浏览');
  console.log('💡 后续添加球队: node football-build.js');
}

main();
