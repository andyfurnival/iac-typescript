local res = ngx.location.capture("/redis",
    { args = { query = "ping\\r\\n" } }
)
ngx.print("[" .. res.body .. "]")
