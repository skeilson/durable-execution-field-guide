/**
 * Builds the interactive course site and the module READMEs from one source:
 *
 *   modules/NN-name/lessons/*.md   lesson text (Markdown)
 *   modules/NN-name/quiz.json      end-of-module quiz
 *   course.json, glossary.json     course outline and glossary
 *
 * Outputs:
 *   site/index.html                full page for GitHub Pages
 *   site/course.html               the same page as a fragment (for hosted previews)
 *   modules/NN-name/README.md      generated module overview for GitHub readers
 *
 * Run with: npm run build:site
 */
import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

type ModuleDef = {
  id: string;
  folder: string;
  title: string;
  tagline: string;
  hours: string;
  status: "ready" | "planned";
  run?: string;
  planned?: string[];
};
type Course = { title: string; subtitle: string; repoUrl: string; modules: ModuleDef[] };
type Quiz = { title: string; questions: { q: string; options: string[]; answer: number; why: string }[] };

const course = JSON.parse(read("course.json")) as Course;
const glossary = JSON.parse(read("glossary.json"));

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A Markdown renderer that knows about lesson conventions. `fileDir` resolves relative links. */
function makeMarked(fileDir: string) {
  const m = new Marked();
  m.use({
    renderer: {
      code({ text, lang }: Tokens.Code) {
        if (lang === "mermaid") return `<div class="diagram"><pre class="mermaid">${escapeHtml(text)}</pre></div>\n`;
        const cls = lang ? ` class="language-${lang}"` : "";
        return `<pre class="code"><code${cls}>${escapeHtml(text)}</code></pre>\n`;
      },
      link({ href, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        let url = href;
        const external = /^https?:/.test(href);
        if (!external && !href.startsWith("#")) {
          const target = path.posix.normalize(path.posix.join(fileDir, href));
          url = `${course.repoUrl}/${href.endsWith("/") ? "tree" : "blob"}/main/${target}`;
        }
        const open = url.startsWith("#") ? "" : ' target="_blank" rel="noopener"';
        return `<a href="${escapeHtml(url)}"${open}>${text}</a>`;
      },
      table(token: Tokens.Table) {
        // Wrap tables so wide ones scroll inside their own box on phones.
        const header = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const rows = token.rows
          .map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`)
          .join("");
        return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return m;
}

type Lesson = { id: string; title: string; time: string; meta: string; html: string; file: string };

function buildLesson(file: string): Lesson {
  const src = read(file);
  const [first, ...rest] = src.split("\n");
  const h1 = first.replace(/^#\s+/, "");
  const [id, ...titleWords] = h1.split(" ");
  let body = rest.join("\n");

  // "**Time:** 15 minutes · **Engine:** [v2](...)" → lesson meta line
  let meta = "";
  body = body.replace(/^\*\*Time:\*\*(.*)$/m, (_, m: string) => {
    meta = m.trim();
    return "";
  });
  const time = meta.split("·")[0].trim();

  // <!-- widget: name {json} --> → interactive widget mount point
  body = body.replace(/<!--\s*widget:\s*([\w-]+)\s*(\{.*?\})?\s*-->/g, (_, name: string, cfg?: string) => {
    const config = cfg ? escapeHtml(cfg) : "{}";
    return `<div class="widget" data-widget="${name}" data-config="${config}"></div>`;
  });
  // The "(In the interactive course: …)" hint is only for GitHub readers.
  body = body.replace(/^\*\(In the interactive course:.*\)\*\s*$/gm, "");

  const dir = path.posix.dirname(file);
  const marked = makeMarked(dir);
  let html = marked.parse(body) as string;
  const metaHtml = meta ? (marked.parseInline(meta) as string) : "";

  // Callout boxes
  html = html
    .replace(/<blockquote>\s*<p><strong>▶ Run it<\/strong>/g, '<blockquote class="callout run"><p><strong>▶ Run it</strong>')
    .replace(/<blockquote>\s*<p><strong>🎧 Support angle<\/strong>/g, '<blockquote class="callout support"><p><strong>Support angle</strong>')
    .replace(/<blockquote>\s*<p><strong>Quick check:<\/strong>/g, '<blockquote class="callout check"><p><strong>Quick check:</strong>');

  return { id, title: titleWords.join(" "), time, meta: metaHtml, html, file };
}

// ---------------------------------------------------------------------------
const modules = course.modules.map((mod) => {
  const lessonsDir = path.join(root, mod.folder, "lessons");
  const files = fs.existsSync(lessonsDir)
    ? fs
        .readdirSync(lessonsDir)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  const lessons = files.map((f) => buildLesson(`${mod.folder}/lessons/${f}`));
  const quizPath = path.join(root, mod.folder, "quiz.json");
  const quiz: Quiz | null = fs.existsSync(quizPath) ? JSON.parse(fs.readFileSync(quizPath, "utf8")) : null;
  return { ...mod, lessons, quiz };
});

// ---------------------------------------------------------------------------
// Module READMEs for GitHub
for (const mod of modules) {
  if (mod.status !== "ready") continue;
  const lines = [
    `<!-- Generated by \`npm run build:site\` from lessons/ and quiz.json. Edit those, not this file. -->`,
    `# Module ${mod.id} · ${mod.title}`,
    "",
    `${mod.tagline}`,
    "",
    `**Time:** about ${mod.hours} hour${mod.hours === "1" ? "" : "s"}${mod.run ? ` · **Hands-on:** \`${mod.run}\`` : ""}`,
    "",
    "## Lessons",
    "",
    "| # | Lesson | Time |",
    "| --- | --- | --- |",
    ...mod.lessons.map((l) => `| ${l.id} | [${l.title}](${path.posix.relative(mod.folder, l.file)}) | ${l.time} |`),
    "",
  ];
  if (mod.quiz) {
    lines.push("## Check your understanding", "", "Answer each question before opening it.", "");
    mod.quiz.questions.forEach((q, i) => {
      lines.push(`**${i + 1}. ${q.q}**`, "");
      q.options.forEach((o, j) => lines.push(`- ${String.fromCharCode(97 + j)}) ${o}`));
      lines.push(
        "",
        "<details><summary>Answer</summary>",
        "",
        `**${String.fromCharCode(97 + q.answer)})** ${q.why}`,
        "",
        "</details>",
        "",
      );
    });
  }
  fs.writeFileSync(path.join(root, mod.folder, "README.md"), lines.join("\n"));
}

// ---------------------------------------------------------------------------
// The site
const data = {
  title: course.title,
  subtitle: course.subtitle,
  repoUrl: course.repoUrl,
  glossary,
  modules: modules.map((m) => ({
    id: m.id,
    title: m.title,
    tagline: m.tagline,
    hours: m.hours,
    status: m.status,
    run: m.run ?? null,
    planned: m.planned ?? [],
    quiz: m.quiz,
    lessons: m.lessons.map(({ id, title, time, meta }) => ({ id, title, time, meta })),
  })),
};

const css = read("site-src/style.css");
const js = read("site-src/app.js");
const json = JSON.stringify(data).replace(/</g, "\\u003c");

const fragment = `<title>${escapeHtml(course.title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="${escapeHtml(course.subtitle)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
${css}
</style>
<div id="app"></div>
<div id="lesson-stash" class="stash" aria-hidden="true">
${modules.flatMap((m) => m.lessons).map((l) => `<article class="prose" data-lesson="${l.id}">\n${l.html}</article>`).join("\n")}
</div>
<script id="course-data" type="application/json">${json}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
<script>
${js}
</script>
`;

fs.mkdirSync(path.join(root, "site"), { recursive: true });
fs.writeFileSync(path.join(root, "site", "course.html"), fragment);
fs.writeFileSync(
  path.join(root, "site", "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${fragment.split('<div id="app">')[0]}
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script>
</head>
<body>
<div id="app">${fragment.split('<div id="app">')[1]}
</body>
</html>
`,
);

const lessonCount = modules.reduce((n, m) => n + m.lessons.length, 0);
console.log(`Built site/index.html and site/course.html: ${modules.length} modules, ${lessonCount} lessons.`);
