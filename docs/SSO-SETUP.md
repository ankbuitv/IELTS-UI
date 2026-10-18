# Cài đặt SSO — Đăng nhập bằng Google / Microsoft

Nút **"Continue with Google"** và **"Continue with Microsoft"** đã có sẵn trên
trang đăng nhập. Bạn chỉ cần tạo "chìa khoá" phía Google/Microsoft rồi khai báo
cho Worker — không phải sửa code.

> **Quy tắc quan trọng:** SSO chỉ là *cách đăng nhập*. Hệ thống khớp tài khoản
> theo **email** — email đăng nhập Google/Microsoft phải trùng email của tài
> khoản đã có trên hệ thống. Chưa có tài khoản → báo lỗi *"No platform account
> matches that provider email"* (học viên phải đăng ký trước, hoặc giáo viên/
> admin tạo tài khoản cho).

---

## 0. URL cần điền ở bước dưới

Với miền sản xuất của bạn:

| Nền tảng | Redirect URI (callback) |
|---|---|
| Google | `https://ielts.ankb.qzz.io/api/auth/sso/google/callback` |
| Microsoft | `https://ielts.ankb.qzz.io/api/auth/sso/microsoft/callback` |

Nếu bạn chạy local (`http://127.0.0.1:8787`), thêm cả
`http://127.0.0.1:8787/api/auth/sso/google/callback` (hoặc `.../microsoft/...`)
vào danh sách redirect URI của ứng dụng để test được.

---

## 1. Google (Google Cloud Console)

1. Vào **https://console.cloud.google.com/apis/credentials** (chọn hoặc tạo
   Project bất kỳ).
2. Vào **OAuth consent screen** → chọn **External** → điền tên app + email hỗ
   trợ → **Save**. (Nếu app ở chế độ *Testing*, chỉ tài khoản Google nằm trong
   **Test users** mới đăng nhập được — thêm email của bạn vào đó, hoặc bấm
   **Publish app**.)
3. Quay lại **Credentials** → **Create credentials** → **OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs** → thêm:
     `https://ielts.ankb.qzz.io/api/auth/sso/google/callback`
4. Bấm **Create** → copy hai giá trị:
   - **Client ID** (dạng `xxxx.apps.googleusercontent.com`)
   - **Client secret** (dạng `GOCSPX-...`)

## 2. Microsoft (Microsoft Entra / Azure)

1. Vào **https://entra.microsoft.com** → **Identity** → **Applications** →
   **App registrations** → **New registration**.
2. Điền:
   - Name: tên app (hiện khi người dùng đăng nhập)
   - Supported account types: **Accounts in any organizational directory and
     personal Microsoft accounts** (nếu chỉ dùng trường học thì chọn tuỳ chọn
     đầu)
   - Redirect URI: chọn **Web** →
     `https://ielts.ankb.qzz.io/api/auth/sso/microsoft/callback`
3. Sau khi tạo → vào **Certificates & secrets** → **New client secret** → copy
   ngay giá trị **Value** (chuỗi `...` — *không* phải Secret ID; chỉ hiện 1 lần).
4. Vào **API permissions** → xác nhận có **Microsoft Graph** với các quyền
   *Delegated*: `openid`, `email`, `profile` (mặc định đã có khi tạo app).

---

## 3. Khai báo cho Worker (Cloudflare)

Mở terminal trong thư mục dự án rồi chạy (dán giá trị khi được hỏi):

```bash
# --- Google ---
npx wrangler secret put SSO_GOOGLE_CLIENT_ID        # dán Client ID
npx wrangler secret put SSO_GOOGLE_CLIENT_SECRET    # dán Client secret

# --- Microsoft ---
npx wrangler secret put SSO_MICROSOFT_CLIENT_ID     # dán Application (client) ID
npx wrangler secret put SSO_MICROSOFT_CLIENT_SECRET # dán giá trị Client secret
```

Xong là có hiệu lực ngay với bản đã deploy (không cần deploy lại; secret nằm ở
phía Cloudflare Worker).

**Cách khác — Cloudflare Dashboard:** Workers & Pages → chọn worker của bạn →
**Settings** → **Variables and Secrets** → **Add** (loại *Secret*) với đúng 4
tên biến ở trên → **Deploy**.

**Chạy local (dev server):** tạo file `.dev.vars` ở thư mục gốc dự án (file này
được git-ignore):

```bash
SSO_GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
SSO_GOOGLE_CLIENT_SECRET="GOCSPX-..."
SSO_MICROSOFT_CLIENT_ID="xxxxxxxx-xxxx-xxxx"
SSO_MICROSOFT_CLIENT_SECRET="~..."
```

rồi khởi động lại `npm run dev`.

---

## 4. Kiểm tra

1. Mở trang **/login** → bấm **Continue with Google** (hoặc Microsoft).
2. Chọn tài khoản có email **đã tồn tại** trên hệ thống → về thẳng trang chủ
   (đã đăng nhập).
3. Nếu cấu hình sai/thiếu biến, nút bấm sẽ báo rõ:
   *"Google sign-in is not configured on this platform yet. Ask an administrator
   to add SSO_GOOGLE_CLIENT_ID."*

## 5. Sự cố thường gặp

| Lỗi | Nguyên nhân / cách sửa |
|---|---|
| `redirect_uri_mismatch` phía Google | Redirect URI trong Google Cloud phải **khớp từng ký tự** với bảng ở mục 0 (có cả `https://`) |
| `No platform account matches...` | Email Google/Microsoft chưa có tài khoản trên hệ thống — tạo tài khoản trước (đăng ký hoặc admin cấp) |
| `SSO_NOT_CONFIGURED` | Quên khai báo 1 trong 4 biến secret, hoặc khai sai tên |
| App Google ở chế độ *Testing* | Email chưa nằm trong **Test users** → thêm vào hoặc **Publish app** |
| Bí mật Microsoft không khớp | Copy lại giá trị **Value** của client secret (mỗi secret chỉ hiện 1 lần khi tạo) |


## Liên kết tài khoản có sẵn (Connect Google/Microsoft)

Ngoài đăng nhập SSO, người dùng đã có tài khoản có thể **liên kết** Google/Microsoft ngay trong app:

- Vào **Profile → Connected accounts → Connect Google / Connect Microsoft**
- Trình duyệt mở trang xác thực của Google/Microsoft, xác nhận xong quay lại trang Profile là xong
- Từ đó đăng nhập bằng 1 chạm qua nút Google/Microsoft ở trang đăng nhập (khớp theo tài khoản đã liên kết trước, sau đó mới tới email)

Người dùng phải **đăng nhập sẵn** mới liên kết được; mỗi tài khoản Google/Microsoft chỉ liên kết với 1 tài khoản nền tảng.
