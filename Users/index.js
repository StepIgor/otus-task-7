const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const app = express();
app.use(bodyParser.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PSWD,
  port: process.env.DB_PORT,
});

const JWT_SECRET = process.env.JWT_SECRET;
const BILLING_SVC_PORT = process.env.BILLING_SVC_PORT;

// Регистрация пользователя
app.post("/register", async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res
      .status(400)
      .json({ error: "Указаны не все данные (name, password)" });
  }
  try {
    const alreadyExistsUser = await pool
      .query("SELECT null FROM users WHERE name = $1", [name])
      .then((res) => res.rows[0]);
    if (alreadyExistsUser) {
      return res
        .status(500)
        .json({ error: "Пользователь с таким именем уже зарегистрирован" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await pool
      .query(
        "INSERT INTO users (Name, Password) VALUES ($1, $2) RETURNING ID",
        [name, hashedPassword]
      )
      .then((res) => res.rows[0]);
    // Регистрируем аккаунт в биллинге
    const billAccCreationQuery = await fetch(
      `http://billing-service:${BILLING_SVC_PORT}/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: newUser.id }),
      }
    );
    if (!billAccCreationQuery.ok) {
      const billErrText = await billAccCreationQuery.text();
      return res
        .status(500)
        .json({ error: billErrText, errorOrigin: "billing service" });
    }
    res.status(201).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

// Аутентификация пользователя
app.post("/login", async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res
      .status(400)
      .json({ error: "Указаны не все данные (name, password)" });
  }
  try {
    const user = await pool
      .query("SELECT ID, Name, Password FROM users WHERE Name = $1", [name])
      .then((res) => res.rows[0]);
    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(403).json({ error: "Неверный пароль" });
    }
    const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, {
      expiresIn: "1h",
      algorithm: "HS256",
    });
    res.status(200).json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
});

const PORT = process.env.APP_PORT;
app.listen(PORT, () => {
  console.log(`Сервис работает по адресу http://localhost:${PORT}`);
});
