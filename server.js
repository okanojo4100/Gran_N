require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { Sequelize, DataTypes, Op } = require('sequelize');

const PORT = process.env.PORT || 3000;

// CONEXIÓN POSTGRESQL CON DATABASE_URL (Render, Railway, etc.)
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    logging: false
});

// Prueba de conexión
sequelize.authenticate()
    .then(() => console.log('Conectado a PostgreSQL con éxito.'))
    .catch(err => console.error('Error al conectar a PostgreSQL:', err));

// ==================== MODELOS ====================
const Registro = sequelize.define('registro', {
    id_registro: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(18), allowNull: false, unique: true },
    correo: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    telefono: { type: DataTypes.STRING, defaultValue: '' },
    genero: { type: DataTypes.ENUM('masculino', 'femenino', 'otro'), allowNull: false },
    fechaCreacion: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'registros', timestamps: false,
    hooks: {
        beforeCreate: async (u) => u.password = await bcrypt.hash(u.password, 10),
        beforeUpdate: async (u) => { if (u.changed('password')) u.password = await bcrypt.hash(u.password, 10); }
    }
});

const Admin = sequelize.define('admin', {
    id_admin: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(18), allowNull: false, unique: true },
    correo: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM('admin'), defaultValue: 'admin' },
    fechaCreacion: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'admins', timestamps: false,
    hooks: {
        beforeCreate: async (a) => a.password = await bcrypt.hash(a.password, 10),
        beforeUpdate: async (a) => { if (a.changed('password')) a.password = await bcrypt.hash(a.password, 10); }
    }
});

const Producto = sequelize.define('producto', {
    id_producto: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    nombre: { type: DataTypes.STRING(50), allowNull: false },
    descripcion: { type: DataTypes.STRING(200), allowNull: false },
    precio: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    stock: { type: DataTypes.INTEGER, allowNull: false },
    fechaCreacion: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    releaseDate: { type: DataTypes.DATE },
    version: { type: DataTypes.STRING, defaultValue: '1.0' },
    format: { type: DataTypes.STRING, defaultValue: 'Digital' },
    inGamePurchases: { type: DataTypes.BOOLEAN, defaultValue: false },
    rating: { type: DataTypes.STRING }
}, { tableName: 'productos', timestamps: false });

const Compra = sequelize.define('compra', {
    id_compra: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    id_registro: { type: DataTypes.INTEGER, allowNull: false },
    id_producto: { type: DataTypes.INTEGER, allowNull: false },
    purchaseDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    status: { type: DataTypes.ENUM('pending', 'completed'), defaultValue: 'pending' },
    shippingName: { type: DataTypes.STRING, allowNull: true },
    shippingPhone: { type: DataTypes.STRING, allowNull: true },
    shippingAddress: { type: DataTypes.STRING, allowNull: true },
    shippingPostalCode: { type: DataTypes.STRING, allowNull: true },
    cantidad: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
}, { tableName: 'compras', timestamps: false });

// Relaciones
Compra.belongsTo(Registro, { foreignKey: 'id_registro', targetKey: 'id_registro' });
Compra.belongsTo(Producto, { foreignKey: 'id_producto', targetKey: 'id_producto' });

// Sincronizar tablas
sequelize.sync({ alter: true })
    .then(() => console.log('Tablas sincronizadas.'))
    .catch(err => console.error('Error al sincronizar tablas:', err));

// ==================== MIDDLEWARES ====================
app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/sweetalert2', express.static(path.join(__dirname, 'node_modules/sweetalert2/dist')));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 24*60*60*1000 }
}));

const isAuthenticated = (req, res, next) => req.session.registroId ? next() : res.redirect('/login');
const isAdmin = (req, res, next) => req.session.role === 'admin' ? next() : res.status(403).send('Acceso denegado');

// ==================== RUTAS ESTÁTICAS ====================
const sendFile = file => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
app.get('/', sendFile('index.html'));
app.get('/productos', sendFile('productos.html'));
app.get('/novedades', sendFile('novedades.html'));
app.get('/login', sendFile('login.html'));
app.get('/registro', sendFile('registro.html'));
app.get('/perfil', isAuthenticated, sendFile('perfil.html'));
app.get('/admin-login', sendFile('admin-login.html'));
app.get('*.html', (req, res) => res.sendFile(path.join(__dirname, 'public', req.path)));

// ==================== API ====================
// Registro
app.post('/registro', async (req, res) => {
    const { username, correo, password, confirmPassword, telefono, genero } = req.body;
    if (!username || !correo || !password || !confirmPassword || !genero) return res.status(400).send('Campos obligatorios.');
    if (password !== confirmPassword) return res.status(400).send('Las contraseñas no coinciden.');
    if (!/^\S+@\S+\.\S+$/.test(correo)) return res.status(400).send('Correo inválido.');
    try {
        const existe = await Registro.findOne({ where: { [Op.or]: [{ correo: correo.toLowerCase() }, { username }] } });
        if (existe) return res.status(409).send('Usuario o correo ya existe.');
        await Registro.create({ username, correo: correo.toLowerCase(), password, telefono: telefono || '', genero });
        res.status(201).send('Registro exitoso');
    } catch (e) { res.status(500).send('Error en el servidor'); }
});

// Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send('Faltan credenciales.');
    try {
        const usuario = await Registro.findOne({
            where: { [Op.or]: [{ correo: email.toLowerCase() }, { username: email }] }
        });
        if (!usuario || !await bcrypt.compare(password, usuario.password)) return res.status(401).send('Credenciales incorrectas.');
        req.session.registroId = usuario.id_registro;
        req.session.username = usuario.username;
        res.send('Inicio de sesión exitoso');
    } catch (e) { res.status(500).send('Error'); }
});

// Estado sesión
app.get('/api/user-status', (req, res) => {
    res.json(req.session.registroId ? { loggedIn: true, username: req.session.username } : { loggedIn: false });
});

// Compra
app.post('/api/comprar/:productId', isAuthenticated, async (req, res) => {
    const { productId } = req.params;
    const { quantity = 1, name, phone, address, postalCode } = req.body;
    if (!name || !phone || !address || !postalCode) return res.status(400).json({ message: 'Faltan datos de envío' });
    try {
        const producto = await Producto.findByPk(productId);
        if (!producto || producto.stock < quantity) return res.status(400).json({ message: 'Producto no disponible' });
        const nuevaCompra = await Compra.create({
            id_registro: req.session.registroId,
            id_producto: productId,
            cantidad: quantity,
            shippingName: name,
            shippingPhone: phone,
            shippingAddress: address,
            shippingPostalCode: postalCode
        });
        await producto.decrement('stock', { by: quantity });
        res.json({ success: true, compraId: nuevaCompra.id_compra });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error en compra' });
    }
});

// Logout
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

// Admin login
app.post('/admin-login', async (req, res) => {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ where: { correo: email.toLowerCase() } });
    if (admin && await bcrypt.compare(password, admin.password)) {
        req.session.adminId = admin.id_admin;
        req.session.role = 'admin';
        req.session.username = admin.username;
        res.send('/admin');
    } else res.status(401).send('Credenciales incorrectas');
});

app.get('/admin', isAdmin, sendFile('admin.html'));

// Crear admin por defecto (solo desarrollo)
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    if (process.env.NODE_ENV !== 'production') crearAdminPorDefecto();
});

async function crearAdminPorDefecto() {
    const adminEmail = 'admin@gmail.com';
    if (!await Admin.findOne({ where: { correo: adminEmail } })) {
        await Admin.create({ username: 'admin', correo: adminEmail, password: 'admin123', role: 'admin' });
        console.log('Admin creado: admin@gmail.com / admin123');
    }
}
