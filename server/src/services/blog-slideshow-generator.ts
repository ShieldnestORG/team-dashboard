/**
 * Blog Slideshow Generator
 *
 * Reuses the YouTube presentation renderer to generate interactive HTML
 * slideshow blog posts. Produces self-contained HTML with embedded CSS,
 * navigation controls, and branded styling from slide templates.
 *
 * Flow: topic → Ollama script → AI slide HTML → self-contained slideshow HTML
 */

import { logger } from "../middleware/logger.js";
import { callOllamaChat } from "./ollama-client.js";
import { buildSlidesFromScriptAI, buildSlidesFromScript, type Slide } from "./youtube/presentation-renderer.js";
import {
  type SlideTemplate,
  getTemplate,
  buildBaseCss,
  hexToRgba,
} from "./youtube/slide-templates.js";
import type { ScriptData, ScriptSection, ScriptHook } from "./youtube/script-writer.js";

// ---------------------------------------------------------------------------
// Build a blog-optimized script from a topic via Ollama
// ---------------------------------------------------------------------------

async function buildBlogScript(topic: string, template: SlideTemplate): Promise<ScriptData> {
  const systemPrompt = `You are a content strategist creating presentation scripts for interactive blog posts.
Generate a JSON object with this exact structure for the topic provided.
The presentation should have 5-8 slides total — concise and punchy for web readers.

Required JSON structure:
{
  "title": "Main title for the presentation",
  "hook": { "type": "question", "text": "An attention-grabbing opening statement or question", "duration": "5s" },
  "introduction": {
    "greeting": "",
    "topicIntro": "Brief context sentence",
    "valueProposition": "What the reader will learn",
    "credibility": "${template.channel}",
    "duration": "10s"
  },
  "mainContent": {
    "sections": [
      {
        "type": "analysis",
        "title": "Section Title",
        "content": ["Key point 1", "Key point 2", "Key point 3"],
        "duration": 15
      }
    ],
    "totalDuration": 60
  },
  "conclusion": {
    "type": "summary",
    "title": "Key Takeaways",
    "recap": ["Takeaway 1", "Takeaway 2", "Takeaway 3"],
    "finalThought": "A memorable closing thought",
    "duration": "10s"
  },
  "callToAction": {
    "type": "explore",
    "subscribe": "Explore more at ${template.name === "tx" ? "app.tokns.fi" : "coherencedaddy.com"}",
    "like": "Share this with your network",
    "comment": "What do you think?",
    "nextVideo": "",
    "duration": "5s"
  },
  "tone": "professional yet engaging",
  "pacing": "moderate"
}

Rules:
- 2-4 main sections, each with 2-4 bullet points
- Keep bullet points under 80 characters
- No markdown formatting in the values
- Return ONLY valid JSON, no markdown fences or extra text`;

  try {
    const result = await callOllamaChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Create a blog presentation script about: ${topic}` },
      ],
      { temperature: 0.7, maxTokens: 4096, timeoutMs: 120_000 },
    );

    let json = result.content.trim();
    // Strip markdown fences
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) json = fenceMatch[1].trim();

    const parsed = JSON.parse(json) as ScriptData;

    // Validate minimum structure
    if (!parsed.title || !parsed.mainContent?.sections?.length) {
      throw new Error("Incomplete script structure from Ollama");
    }

    // Fill in fields that the blog prompt doesn't generate (YouTube-specific)
    if (!parsed.keywords) parsed.keywords = parsed.title.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 6);
    if (!parsed.duration) parsed.duration = "2 minutes";
    if (!parsed.fullScript) parsed.fullScript = "";

    return parsed;
  } catch (err) {
    logger.warn({ err, topic }, "Ollama blog script generation failed, using fallback");
    return buildFallbackScript(topic, template);
  }
}

function buildFallbackScript(topic: string, template: SlideTemplate): ScriptData {
  const cleanTopic = topic.replace(/\. Write.*$/, "").slice(0, 100);
  return {
    title: cleanTopic,
    hook: { type: "statement", text: `Everything you need to know about ${cleanTopic}`, duration: "5s" } as ScriptHook,
    introduction: {
      greeting: "",
      topicIntro: `A deep dive into ${cleanTopic}`,
      valueProposition: "Key insights and analysis",
      credibility: template.channel,
      duration: "10s",
    },
    mainContent: {
      sections: [
        { type: "overview", title: "Overview", content: ["Current state of the ecosystem", "Key metrics and trends", "What the data shows"], duration: 20 } as ScriptSection,
        { type: "analysis", title: "Analysis", content: ["Market implications", "Technical developments", "Growth trajectory"], duration: 20 } as ScriptSection,
        { type: "outlook", title: "What's Next", content: ["Short-term outlook", "Long-term potential", "Key factors to watch"], duration: 20 } as ScriptSection,
      ],
      totalDuration: 60,
    },
    conclusion: {
      type: "summary",
      title: "Key Takeaways",
      recap: ["The data points to continued growth", "Ecosystem fundamentals remain strong", "Monitor developments closely"],
      finalThought: "Stay informed and stay ahead.",
      duration: "10s",
    },
    callToAction: {
      type: "explore",
      subscribe: `Explore more at ${template.name === "tx" ? "app.tokns.fi" : "coherencedaddy.com"}`,
      like: "Share this with your network",
      comment: "What do you think?",
      nextVideo: "",
      duration: "5s",
    },
    tone: "professional",
    pacing: "moderate",
    keywords: cleanTopic.split(/\s+/).filter((w) => w.length > 3).slice(0, 6),
    duration: "2 minutes",
    fullScript: "",
  };
}

// ---------------------------------------------------------------------------
// Assemble slides into self-contained HTML slideshow
// ---------------------------------------------------------------------------

function assembleSlideshowHtml(slides: Slide[], template: SlideTemplate): string {
  const slideCount = slides.length;
  const baseCss = buildBaseCss(template);

  const slidesHtml = slides
    .map((slide, i) => {
      // Extract inner body content from full HTML documents
      let content = slide.html;
      const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) content = bodyMatch[1];
      // Also strip out any <style> tags from individual slides (we use our own)
      content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

      return `<div class="ss-slide" data-slide-index="${i}" ${i === 0 ? "" : 'style="display:none"'}>${content}</div>`;
    })
    .join("\n");

  return `<div data-slideshow="true" data-slide-count="${slideCount}" class="ss-container">
<style>
${baseCss}
.ss-container {
  position: relative;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  font-family: ${template.font};
  -webkit-font-smoothing: antialiased;
}
.ss-viewport {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 12px;
  background: ${template.primaryBg};
  border: 1px solid ${hexToRgba(template.primary, 0.2)};
}
.ss-slide {
  position: absolute;
  inset: 0;
  width: 1920px;
  height: 1080px;
  transform-origin: top left;
  overflow: hidden;
}
.ss-slide * { max-width: 100%; }
.ss-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px 0;
}
.ss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid ${hexToRgba(template.primary, 0.3)};
  background: ${template.secondaryBg};
  color: ${template.text};
  cursor: pointer;
  font-size: 18px;
  transition: all 0.2s;
}
.ss-btn:hover { background: ${hexToRgba(template.primary, 0.15)}; border-color: ${template.primary}; }
.ss-btn:disabled { opacity: 0.3; cursor: default; }
.ss-dots {
  display: flex;
  gap: 6px;
  align-items: center;
}
.ss-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${hexToRgba(template.text, 0.2)};
  transition: all 0.2s;
  cursor: pointer;
  border: none;
  padding: 0;
}
.ss-dot.active {
  background: ${template.primary};
  width: 24px;
  border-radius: 4px;
}
.ss-counter {
  font-size: 12px;
  color: ${hexToRgba(template.text, 0.4)};
  font-family: ${template.font};
}
@media (max-width: 768px) {
  .ss-btn { width: 36px; height: 36px; font-size: 16px; }
  .ss-dot { width: 6px; height: 6px; }
  .ss-dot.active { width: 18px; }
}
</style>

<div class="ss-viewport" id="ss-viewport">
  ${slidesHtml}
</div>

<div class="ss-nav">
  <button class="ss-btn" id="ss-prev" title="Previous slide" aria-label="Previous slide">&#8249;</button>
  <div class="ss-dots" id="ss-dots">
    ${slides.map((_, i) => `<button class="ss-dot${i === 0 ? " active" : ""}" data-dot="${i}" aria-label="Go to slide ${i + 1}"></button>`).join("")}
  </div>
  <button class="ss-btn" id="ss-next" title="Next slide" aria-label="Next slide">&#8250;</button>
  <span class="ss-counter" id="ss-counter">1 / ${slideCount}</span>
</div>

<script>
(function(){
  var cur = 0, total = ${slideCount};
  var slides = document.querySelectorAll('.ss-slide');
  var dots = document.querySelectorAll('.ss-dot');
  var counter = document.getElementById('ss-counter');
  var prevBtn = document.getElementById('ss-prev');
  var nextBtn = document.getElementById('ss-next');
  var viewport = document.getElementById('ss-viewport');

  function scaleSlides() {
    var w = viewport.offsetWidth;
    var s = w / 1920;
    slides.forEach(function(sl) {
      sl.style.transform = 'scale(' + s + ')';
    });
    viewport.style.height = (1080 * s) + 'px';
  }

  function go(n) {
    if (n < 0 || n >= total) return;
    slides[cur].style.display = 'none';
    cur = n;
    slides[cur].style.display = '';
    dots.forEach(function(d, i) { d.classList.toggle('active', i === cur); });
    counter.textContent = (cur + 1) + ' / ' + total;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === total - 1;
  }

  prevBtn.onclick = function() { go(cur - 1); };
  nextBtn.onclick = function() { go(cur + 1); };
  dots.forEach(function(d) { d.onclick = function() { go(+d.dataset.dot); }; });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowLeft') go(cur - 1);
    else if (e.key === 'ArrowRight') go(cur + 1);
  });

  var startX = 0;
  viewport.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; }, {passive:true});
  viewport.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) { dx > 0 ? go(cur - 1) : go(cur + 1); }
  }, {passive:true});

  scaleSlides();
  window.addEventListener('resize', scaleSlides);
  prevBtn.disabled = true;
  if (total <= 1) nextBtn.disabled = true;
})();
</script>
</div>`;
}

// ---------------------------------------------------------------------------
// Main entry: generate a slideshow blog post
// ---------------------------------------------------------------------------

export async function generateSlideshowBlog(
  topic: string,
  templateName: "coherencedaddy" | "tx" = "coherencedaddy",
): Promise<{ html: string; title: string; slideCount: number }> {
  const template = getTemplate(templateName);

  logger.info({ topic, template: templateName }, "Generating slideshow blog script");
  const script = await buildBlogScript(topic, template);

  logger.info({ title: script.title, sections: script.mainContent.sections.length }, "Building slides from script");
  let slides: Slide[];
  try {
    slides = await buildSlidesFromScriptAI(script, template);
  } catch (err) {
    logger.warn({ err }, "AI slide generation failed, falling back to static");
    slides = buildSlidesFromScript(script, template);
  }

  if (slides.length === 0) {
    throw new Error("No slides generated");
  }

  logger.info({ slideCount: slides.length }, "Assembling slideshow HTML");
  const html = assembleSlideshowHtml(slides, template);

  return {
    html,
    title: script.title,
    slideCount: slides.length,
  };
}
