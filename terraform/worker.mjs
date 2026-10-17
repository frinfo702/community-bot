// Rendered by Terraform (templatefile) with the built 404 page. See main.tf.
const html = ${jsonencode(html)};

export default {
  fetch() {
    return new Response(html, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
