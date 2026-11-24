import hashlib, hmac, datetime, urllib.request, pathlib
ak="recrutement-user-service"
sk="f2bcn9P2ZzMseEjnQPiroLOGK25q0sWX7xYRoc5nTy4="
bucket="recrutement-cvs"
host="127.0.0.1:8333"
keys=[
"cvs/99910/152ec33b-f7c0-484d-b91a-b5c812d31dfb.pdf",
"cvs/99911/45bde005-07e6-46a0-87db-7d35d9dc6dc2.pdf",
"cvs/99912/e188f59b-f66c-4ab3-a116-4e7bba774e83.pdf",
"cvs/99913/aa41d11c-ce47-4b1c-a13c-a0e4b9fc0a73.pdf",
]
out=pathlib.Path(r"C:\Users\ayame\Downloads\dechli-ai-service-complet\dechli-ai-service\data\tmp_qa_cvs")
out.mkdir(parents=True, exist_ok=True)

def sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

def get_object(object_key, dest):
    now=datetime.datetime.utcnow()
    amzdate=now.strftime("%Y%m%dT%H%M%SZ")
    datestamp=now.strftime("%Y%m%d")
    region="us-east-1"
    service="s3"
    canonical_uri="/"+bucket+"/"+object_key
    canonical_querystring=""
    payload_hash=hashlib.sha256(b"").hexdigest()
    canonical_headers=f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amzdate}\n"
    signed_headers="host;x-amz-content-sha256;x-amz-date"
    canonical_request="\n".join([
        "GET", canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
    ])
    algorithm="AWS4-HMAC-SHA256"
    credential_scope=f"{datestamp}/{region}/{service}/aws4_request"
    string_to_sign="\n".join([
        algorithm, amzdate, credential_scope, hashlib.sha256(canonical_request.encode()).hexdigest()
    ])
    kDate=sign(("AWS4"+sk).encode(), datestamp)
    kRegion=hmac.new(kDate, region.encode(), hashlib.sha256).digest()
    kService=hmac.new(kRegion, service.encode(), hashlib.sha256).digest()
    kSigning=hmac.new(kService, b"aws4_request", hashlib.sha256).digest()
    signature=hmac.new(kSigning, string_to_sign.encode(), hashlib.sha256).hexdigest()
    auth=f"{algorithm} Credential={ak}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    url=f"http://{host}{canonical_uri}"
    req=urllib.request.Request(url, method="GET")
    req.add_header("x-amz-date", amzdate)
    req.add_header("x-amz-content-sha256", payload_hash)
    req.add_header("Authorization", auth)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data=resp.read()
    dest.write_bytes(data)
    print(dest.name, len(data), data[:4])

for k in keys:
    dest=out / pathlib.Path(k).name
    get_object(k, dest)
print("DONE")
