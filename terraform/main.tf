locals {
  assets_dir     = "${path.module}/../doc/dist"
  not_found_html = file("${path.module}/../doc/dist/404.html")
}

resource "cloudflare_workers_script" "docs" {
  account_id         = var.account_id
  script_name        = var.worker_name
  content            = templatefile("${path.module}/worker.mjs", { html = local.not_found_html })
  main_module        = "worker.mjs"
  compatibility_date = var.compatibility_date

  assets = {
    directory = local.assets_dir

    config = {
      html_handling = "auto-trailing-slash"
      headers       = file("${path.module}/headers.txt")
    }
  }
}

resource "cloudflare_workers_script_subdomain" "docs" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.docs.script_name
  enabled     = true
}
