# Billing & Pro

## Plans

| Plan | Price | Months |
|---|---|---|
| `pro_monthly` | 199.000 ₫ | 1 |
| `pro_yearly` | 1.590.000 ₫ (132.500 ₫/tháng) | 12 |

Giá nằm trong `src/shared/billing.ts`. Worker **không** tin giá từ client: request
chỉ gửi `plan` id, số tiền đọc từ bảng này.

## Payment paths

### 1. Card — Stripe Checkout

Cần hai secret:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

- `POST /api/billing/checkout` với `provider: "CARD"` tạo Checkout Session
  (`mode=payment`, VND, `client_reference_id` = order id) và trả `redirectUrl`.
- Webhook: `POST /api/billing/stripe/webhook`.
  - Stripe ký `t=...,v1=...` trên `${t}.${rawBody}`; chữ ký được kiểm tra bằng
    HMAC-SHA256, sai lệch thời gian > 300 s bị từ chối.
  - Chỉ xử lý `checkout.session.completed` (khi `payment_status = paid`) và
    `checkout.session.async_payment_succeeded`.
- Đơn chỉ thành PAID khi webhook tới. Người dùng thoát trang Stripe → không có quyền.

### 2. Bank transfer — VNPay/MoMo thay thế

Không cần merchant credential:

- `provider: "BANK"` tạo đơn `PENDING` kèm `reference` (ví dụ `IELTS-TKY0VE`).
- Hiển thị hướng dẫn chuyển khoản. Điền thông tin qua ba biến:

```bash
npx wrangler secret put BILLING_BANK_NAME
npx wrangler secret put BILLING_BANK_ACCOUNT
npx wrangler secret put BILLING_BANK_HOLDER
```

- Admin vào **Admin → Billing**, đối chiếu reference + số tiền rồi bấm *Confirm paid*.
- `POST /api/admin/billing/orders/:id/approve` gọi `markOrderPaid`, idempotent.

Khi có merchant VNPay/MoMo, chỉ cần thêm một provider mới trong
`startCheckout` + `markOrderPaid`; phần đơn hàng và quyền lợi không đổi.

### 3. Demo — chỉ ngoài production

`provider: "DEMO"` kích hoạt ngay, chỉ khi `APP_ENV !== 'production'`. Dùng để đi
hết luồng trên preview mà không cần key.

## Order lifecycle

`PENDING → PAID` (webhook hoặc admin duyệt) · `PENDING → CANCELLED` (người dùng
huỷ) · `PENDING → EXPIRED` (quá 48 giờ; hiện chỉ là mốc dữ liệu, chưa có cron).

Một tài khoản có tối đa một `user_subscriptions` row. Gia hạn khi đang còn hạn sẽ
cộng dồn từ `current_period_end`, không reset.

Huỷ gia hạn: `POST /api/billing/subscription/cancel` đặt `status = CANCELLED`
nhưng quyền vẫn còn tới hết kỳ (`subscriptionIsActive` chấp nhận CANCELLED còn hạn).
Gia hạn lại bằng cách mua gói mới sau khi hết hạn.

## Pro enforcement

| Limit | Free | Pro |
|---|---|---|
| AI speaking partner sessions | 3/ngày | không giới hạn |
| Question-type drills | 5/ngày | không giới hạn |

Server kiểm tra qua `isPro(env, userId)`; lỗi trả `409` với câu giải thích và
trang tương ứng có link tới `/pricing`.

## Endpoints

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/billing` | trạng thái + đơn hàng + season + cờ cấu hình |
| POST | `/api/billing/checkout` | `{ plan, provider }` |
| POST | `/api/billing/subscription/cancel` | huỷ gia hạn, giữ quyền tới kỳ hạn |
| POST | `/api/billing/orders/:id/cancel` | huỷ đơn PENDING |
| POST | `/api/billing/stripe/webhook` | không cần session cookie, cần chữ ký |
| GET | `/api/admin/billing/orders?status=` | admin queue |
| POST | `/api/admin/billing/orders/:id/approve` | xác nhận chuyển khoản |

## Test nhanh (local)

```bash
npm run dev:api
# đăng nhập student@demo.test / Demo-Passw0rd!23
curl -s -b jar -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  -d '{"plan":"pro_monthly","provider":"DEMO"}' http://127.0.0.1:8787/api/billing/checkout
```

Webhook có thể test bằng chữ ký tự tạo: `tests/unit/billing.test.ts` kiểm tra
đúng/sai/thời gian lệch.
