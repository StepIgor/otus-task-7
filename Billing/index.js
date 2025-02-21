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

// Отправка сообщений в RabbitMQ
async function publishToQueue(queue, message) {
  try {
    const connection = await amqp.connect(RABBIT_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue(queue, { durable: true });
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
    });
    await channel.close();
    await connection.close();
  } catch (error) {
    console.error("Ошибка отправки сообщения в RabbitMQ:", error.message);
  }
}

// ROUTES
app.post("/register", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "Не указан userId" });
  }
  try {
    const amount = await pool
      .query("SELECT Amount FROM accounts WHERE id = $1", [userId])
      .then((res) => res.rows[0]);
    if (Number.isInteger(amount)) {
      res.status(400).json({ error: "Аккаунт уже существует" });
      return;
    }
    const newUserQuery = await pool.query(
      "INSERT INTO accounts (ID, Amount) VALUES ($1, 0) RETURNING *",
      [userId]
    );
    res.status(201).json(newUserQuery.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.post("/charge", async (req, res) => {
  // Недоступен клиентам. Используется сервисом Orders при оплате заказа
  const { userId, orderId, amount } = req.body;
  if (!userId || !orderId || !amount) {
    res
      .status(400)
      .json({ error: "Указаны не все данные (userId, orderId, amount)" });
    return;
  }
  try {
    const queryResult = await pool.query(
      "SELECT Amount FROM accounts WHERE ID = $1",
      [userId]
    );
    if (!queryResult?.rows?.length) {
      res.status(404).json({ error: "Аккаунта списания не существует" });
      return;
    }
    if (Number(amount) > Number(queryResult.rows[0].amount)) {
      publishToQueue("billing_notifications", {
        userId,
        Text: `Не удалось оплатить заказ №${orderId} на сумму ${amount}₽. На вашем счету недостаточно средств (баланс: ${queryResult.rows[0].amount}₽).`,
      });
      res.status(400).json({ error: "Недостаточно средств" });
      return;
    }
    await pool.query("UPDATE accounts SET Amount = Amount - $1 WHERE ID = $2", [
      amount,
      userId,
    ]);
    publishToQueue("billing_notifications", {
      userId,
      Text: `Заказ №${orderId} на сумму ${amount}₽ успешно оплачен!`,
    });
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unhandled internal server error" });
  }
});

app.post("/topup", authenticateToken, async (req, res) => {
  // Доступен для клиентов
  const [userId, amount] = [req.user.id, req.body.amount];
  if (!userId || !amount) {
    res.status(400).json({ error: "Не все данные указаны (userId, amount)" });
    return;
  }
  try {
    const queryResult = await pool.query(
      "SELECT Amount FROM accounts WHERE ID = $1",
      [userId]
    );
    if (!queryResult?.rows?.length) {
      res.status(404).json({ error: "Аккаунта пополнения не существует" });
      return;
    }
    const newAmountData = await pool.query(
      "UPDATE accounts SET Amount = Amount + $1 WHERE ID = $2 RETURNING *",
      [amount, userId]
    );
    res.status(200).json(newAmountData.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

app.get("/balance", authenticateToken, async (req, res) => {
  // Доступен для клиентов
  try {
    const amount = await pool
      .query("SELECT Amount FROM accounts WHERE ID = $1", [req.user.id])
      .then((res) => res.rows[0].amount);
    res.status(200).json({ amount });
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
