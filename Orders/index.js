const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const app = express();
app.use(bodyParser.json());

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PSWD,
  port: process.env.DB_PORT,
});

const JWT_SECRET = process.env.JWT_SECRET;
const BILLING_SVC_PORT = process.env.BILLING_SVC_PORT;

// Middleware для проверки JWT-токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Отказ в доступе. Нет токена" });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res
        .status(403)
        .json({ error: "Отказ в доступе. Некорректный токен" });
    }
    req.user = user;
    next();
  });
};

// ROUTES
app.post("/orders", authenticateToken, async (req, res) => {
  // заведение заказа
  const [userId, amount] = [req.user.id, req.body.amount];
  if (!userId || !amount) {
    return res.status(400).json({ error: "Не указан amount" });
  }
  try {
    // заведение заказа в статусе pending
    const newOrder = await pool
      .query(
        "INSERT INTO orders (UserID, Amount, Status) VALUES ($1, $2, 'Pending') RETURNING ID",
        [userId, amount]
      )
      .then((res) => res.rows[0]);
    // попытка списания в сервисе биллинга
    const billPayment = await fetch(
      `http://billing-service:${BILLING_SVC_PORT}/charge`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId, amount, orderId: newOrder.id }),
      }
    );
    // актуализация статуса заказа
    const updatedOrder = await pool
      .query(
        "UPDATE orders SET Status = $1 WHERE id = $2 RETURNING ID, Amount, Status",
        [billPayment.ok ? "Success" : "Failed", newOrder.id]
      )
      .then((res) => res.rows);
    res.status(201).json(updatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.get("/orders", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const orders = await pool
      .query(
        "SELECT ID, Amount, Status FROM orders WHERE UserID = $1 ORDER BY ID DESC",
        [userId]
      )
      .then((res) => res.rows);
    res.status(200).json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Start server
const PORT = process.env.APP_PORT;
app.listen(PORT, () => {
  console.log(`Сервис запущен на http://localhost:${PORT}`);
});
