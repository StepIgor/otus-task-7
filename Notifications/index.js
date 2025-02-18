const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const amqp = require("amqplib");

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

const RABBIT_URL = `amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PASS}@rabbitmq`;
const JWT_SECRET = process.env.JWT_SECRET;

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

// Чтение сообщений от сервиса биллинга
async function consumeBillingMessages() {
  try {
    const connection = await amqp.connect(RABBIT_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue("billing_notifications", { durable: true });
    channel.consume("billing_notifications", async (msg) => {
      if (!msg) {
        return;
      }
      const msgContent = JSON.parse(msg.content.toString());
      await pool.query(
        "INSERT INTO notifications (userId, Text) VALUES ($1, $2)",
        [msgContent.userId, msgContent.Text]
      );
      channel.ack(msg);
    });
  } catch (err) {
    console.error("Ошибка при подключении к RabbitMQ:", err.message);
  }
}

// ROUTES
app.get("/notifications", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const orders = await pool
      .query(
        "SELECT ID, Text FROM notifications WHERE UserID = $1 ORDER BY ID DESC",
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
consumeBillingMessages();
