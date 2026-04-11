/**
 * Blog Loader — fetches partner content feed and renders post cards.
 * @param {string} feedUrl - The partner site content feed URL
 * @param {string} containerSelector - CSS selector for the container element
 * @param {number} limit - Max posts to show (0 = all)
 */
function loadBlogPosts(feedUrl, containerSelector, limit) {
  var container = document.querySelector(containerSelector);
  if (!container) return;

  fetch(feedUrl)
    .then(function (res) {
      if (!res.ok) throw new Error("Feed request failed: " + res.status);
      return res.json();
    })
    .then(function (data) {
      var posts = data.content || [];
      if (limit && limit > 0) posts = posts.slice(0, limit);

      if (posts.length === 0) {
        container.innerHTML = '<p class="blog-empty">No articles yet. Check back soon!</p>';
        return;
      }

      var html = "";
      for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        var date = post.publishedAt
          ? new Date(post.publishedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "";
        var excerpt = post.metaDescription || truncate(stripHtml(post.body), 150);
        var postUrl = "blog/" + post.slug + ".html";

        html +=
          '<a href="' + postUrl + '" class="blog-card">' +
            '<h3>' + escapeHtml(post.title) + '</h3>' +
            (date ? '<span class="blog-date">' + date + '</span>' : '') +
            '<p class="blog-excerpt">' + escapeHtml(excerpt) + '</p>' +
          '</a>';
      }

      container.innerHTML = html;
    })
    .catch(function () {
      container.innerHTML = '<p class="blog-empty">No articles yet. Check back soon!</p>';
    });
}

function stripHtml(html) {
  var tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return tmp.textContent || tmp.innerText || "";
}

function truncate(str, len) {
  if (!str) return "";
  if (str.length <= len) return str;
  return str.substring(0, len).replace(/\s+\S*$/, "") + "...";
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
