require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { Sequelize, DataTypes, Op } = require('sequelize'); // Importado 'Op'
const PORT = process.env.PORT || 3000;

// ====================================================================
// === CONFIGURACIÓN DE SEQUELIZE (MySQL) ===
// ====================================================================

// CAMBIO: PostgreSQL en vez de MySQL
const sequelize = new Sequelize(
    process.env.DB_NAME,           // Railway usa DATABASE_URL o estas variables
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',       // ← SOLO ESTO CAMBIA
        dialectOptions: {
            ssl: {                     // ← NECESARIO para PostgreSQL en Railway
                require: true,
                rejectUnauthorized: false
            }
        },
        logging: false
    }
);
// Probar conexión
sequelize.authenticate()
    .then(() => console.log('Conectado a MySQL con éxito.'))
    .catch(err => console.error('Error al conectar a MySQL:', err));

// ====================================================================
// === Modelos Sequelize ===
// Se han cambiado todos los nombres de las claves primarias (PK)
// ====================================================================

// Modelo: registros (usuarios comunes)
const Registro = sequelize.define('registro', {
    // CLAVE PRIMARIA CAMBIADA
    id_registro: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, 
    username: { type: DataTypes.STRING(18), allowNull: false, unique: true },
    correo: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    telefono: { type: DataTypes.STRING, defaultValue: '' },
    genero: { type: DataTypes.ENUM('masculino', 'femenino', 'otro'), allowNull: false },
    fechaCreacion: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    tableName: 'registros',
    timestamps: false,
    hooks: {
        beforeCreate: async (user) => {
            user.password = await bcrypt.hash(user.password, 10);
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                user.password = await bcrypt.hash(user.password, 10);
            }
        }
    }
});

// Modelo: admins
const Admin = sequelize.define('admin', {
    // CLAVE PRIMARIA CAMBIADA
    id_admin: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }, 
    username: { type: DataTypes.STRING(18), allowNull: false, unique: true },
    correo: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM('admin'), defaultValue: 'admin' },
    fechaCreacion: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    tableName: 'admins',
    timestamps: false,
    hooks: {
        beforeCreate: async (admin) => {
            admin.password = await bcrypt.hash(admin.password, 10);
        },
        beforeUpdate: async (admin) => {
            if (admin.changed('password')) {
                admin.password = await bcrypt.hash(admin.password, 10);
            }
        }
    }
});

// Modelo: productos
const Producto = sequelize.define('producto', {
    // CLAVE PRIMARIA CAMBIADA
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
}, {
    tableName: 'productos',
    timestamps: false
});

// Modelo: compras
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

    // ← ESTE CAMPO ES EL QUE QUERÍAS
    cantidad: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    }
    // ← FIN
}, {
    tableName: 'compras',
    timestamps: false
});

// ====================================================================
// === Relaciones (Ajustadas para usar los nuevos nombres de FK) ===
// ====================================================================
// El foreignKey DEBE coincidir con el nombre de la columna en la tabla 'compras'
Compra.belongsTo(Registro, { foreignKey: 'id_registro', targetKey: 'id_registro' });
Compra.belongsTo(Producto, { foreignKey: 'id_producto', targetKey: 'id_producto' });

// === Sincronizar modelos (crear tablas si no existen) ===
sequelize.sync({ alter: true })
    .then(() => console.log('Tablas sincronizadas.'))
    .catch(err => console.error('Error al sincronizar tablas:', err));

// ====================================================================
// === Express Middleware y Middlewares de Autenticación ===
// ====================================================================
app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/sweetalert2', express.static(path.join(__dirname, 'node_modules/sweetalert2/dist')));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// Middlewares que usan la sesión
function isAuthenticated(req, res, next) {
    // Usamos 'registroId' para la sesión de usuario común
    if (req.session.registroId) next(); 
    else res.redirect('/login');
}

function isAdmin(req, res, next) {
    if (req.session.role === 'admin') next();
    else res.status(403).send('Acceso denegado: Solo para administradores.');
}

// === Rutas estáticas ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/productos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'productos.html')));
app.get('/novedades', (req, res) => res.sendFile(path.join(__dirname, 'public', 'novedades.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/registro', (req, res) => res.sendFile(path.join(__dirname, 'public', 'registro.html')));
app.get('/perfil', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public', 'perfil.html')));
app.get('/admin-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/luigis-mansion-2.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'luigis-mansion-2.html')));
app.get('/new-super-mario-bros-u-deluxe.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'new-super-mario-bros-u-deluxe.html')));

// ====================================================================
// === Rutas API (Ajustadas para usar los nuevos nombres de ID) ===
// ====================================================================

// Registro
app.post('/registro', async (req, res) => {
    const { username, correo, password, confirmPassword, telefono, genero } = req.body;
    if (!username || !correo || !password || !confirmPassword || !genero) 
        return res.status(400).send('Error: Todos los campos obligatorios deben ser completados.');
    if (password !== confirmPassword) 
        return res.status(400).send('Error: Las contraseñas no coinciden.');
    if (!/^\S+@\S+\.\S+$/.test(correo)) 
        return res.status(400).send('Error: El formato del correo electrónico no es válido.');

    try {
        const existe = await Registro.findOne({ 
            where: { [Op.or]: [{ correo: correo.toLowerCase() }, { username: username }] } 
        });
        if (existe) return res.status(409).send('Error: El correo electrónico o nombre de usuario ya está en uso.');

        await Registro.create({
            username, correo: correo.toLowerCase(), password, telefono: telefono || '', genero
        });

        res.status(201).send('Registro exitoso');
    } catch (error) {
        console.error('Error al registrar:', error);
        if (error.name === 'SequelizeUniqueConstraintError') {
             return res.status(409).send('Error: El nombre de usuario o correo electrónico ya están en uso.');
        }
        res.status(500).send('Hubo un error en el servidor.');
    }
});

// Login usuario
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send('Por favor, ingresa tu correo y contraseña.');

    try {
        const usuario = await Registro.findOne({
            where: {
                [Op.or]: [
                    { correo: email.toLowerCase() },
                    { username: email }
                ]
            }
        });

        if (!usuario || !await bcrypt.compare(password, usuario.password))
            return res.status(401).send('Credenciales incorrectas.');

        // Se usa la nueva clave primaria 'id_registro'
        req.session.registroId = usuario.id_registro; 
        req.session.username = usuario.username;
        res.status(200).send('Inicio de sesión exitoso');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error del servidor.');
    }
});

// === VERIFICAR ESTADO DE SESIÓN ===
app.get('/api/user-status', (req, res) => {
    if (req.session.registroId) {
        res.json({
            loggedIn: true,
            username: req.session.username || 'Usuario'
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// Admin login
app.post('/admin-login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const admin = await Admin.findOne({ where: { correo: email.toLowerCase() } });
        if (!admin || !await bcrypt.compare(password, admin.password))
            return res.status(401).send('Credenciales incorrectas.');

        // Se usa la nueva clave primaria 'id_admin'
        req.session.adminId = admin.id_admin; 
        req.session.username = admin.username;
        req.session.role = admin.role;
        res.status(200).send('/admin');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error del servidor.');
    }
});

// === CRUD Usuarios (Admin) ===
app.get('/api/usuarios', isAdmin, async (req, res) => {
    const usuarios = await Registro.findAll({ attributes: { exclude: ['password'] } });
    res.json(usuarios);
});

// La búsqueda usa el ID del parámetro, Sequelize usa la PK por defecto (id_registro)
app.put('/api/usuarios/:id', isAdmin, async (req, res) => {
    const { username, genero, telefono } = req.body;
    const [updated] = await Registro.update({ username, genero, telefono }, { where: { id_registro: req.params.id } });
    updated ? res.send('Usuario actualizado.') : res.status(404).send('Usuario no encontrado.');
});

app.delete('/api/usuarios/:id', isAdmin, async (req, res) => {
    const deleted = await Registro.destroy({ where: { id_registro: req.params.id } });
    deleted ? res.send('Usuario eliminado.') : res.status(404).send('Usuario no encontrado.');
});

// === CRUD Productos ===
app.get('/api/productos', isAdmin, async (req, res) => {
    const productos = await Producto.findAll();
    res.json(productos);
});

// Búsqueda usa el ID del parámetro, Sequelize usa la PK por defecto (id_producto)
app.get('/api/productos/:id', async (req, res) => {
    const producto = await Producto.findByPk(req.params.id);
    producto ? res.json(producto) : res.status(404).send('Producto no encontrado.');
});

app.post('/api/productos', isAdmin, async (req, res) => {
    const { nombre, descripcion, precio, stock } = req.body;
    if (!nombre || !descripcion || !precio || !stock) return res.status(400).send('Todos los campos son obligatorios.');
    await Producto.create({ nombre, descripcion, precio, stock });
    res.status(201).send('Producto creado.');
});

app.put('/api/productos/:id', isAdmin, async (req, res) => {
    const { nombre, descripcion, precio, stock } = req.body;
    const [updated] = await Producto.update({ nombre, descripcion, precio, stock }, { where: { id_producto: req.params.id } });
    updated ? res.send('Producto actualizado.') : res.status(404).send('Producto no encontrado.');
});

app.delete('/api/productos/:id', isAdmin, async (req, res) => {
    const deleted = await Producto.destroy({ where: { id_producto: req.params.id } });
    deleted ? res.send('Producto eliminado.') : res.status(404).send('Producto no encontrado.');
});

// === Perfil ===
app.get('/api/obtener-perfil', isAuthenticated, async (req, res) => {
    // Usamos el id de la sesión de registro
    const user = await Registro.findByPk(req.session.registroId, { attributes: { exclude: ['password'] } });
    user ? res.json(user) : res.status(404).send('Usuario no encontrado.');
});

app.post('/api/actualizar-perfil', isAuthenticated, async (req, res) => {
    const { username, genero, telefono, oldPassword, newPassword } = req.body;
    const user = await Registro.findByPk(req.session.registroId); // Usamos el id de la sesión de registro

    if (!user) return res.status(404).send('Usuario no encontrado.');

    const updates = {};
    if (username) updates.username = username;
    if (genero) updates.genero = genero;
    if (telefono !== undefined) updates.telefono = telefono;

    if (oldPassword && newPassword) {
        if (!await bcrypt.compare(oldPassword, user.password))
            return res.status(401).send('Contraseña anterior incorrecta.');
        if (await bcrypt.compare(newPassword, user.password))
            return res.status(400).send('No puedes usar la misma contraseña.');
        updates.password = newPassword; 
    }

    await user.update(updates);
    res.send('Perfil actualizado.');
});

// === Compra ===
app.post('/api/comprar/:productId', isAuthenticated, async (req, res) => {
    const { productId } = req.params;
    const { quantity = 1, name, phone, address, postalCode, cardNumber, expiryDate, cvv } = req.body;

    if (!name || !phone || !address || !postalCode)
        return res.status(400).json({ message: 'Todos los campos de envío son obligatorios.' });

    try {
        const producto = await Producto.findByPk(productId);
        if (!producto) return res.status(404).json({ message: 'Producto no encontrado.' });
        if (producto.stock < quantity) return res.status(400).json({ message: 'Stock insuficiente.' });

        // Crear la compra y obtener el objeto completo (con id_compra)
       const nuevaCompra = await Compra.create({
        id_registro: req.session.registroId,
        id_producto: productId,
        cantidad: quantity,           // ← Aquí se guarda cuántas compró
        shippingName: name,
        shippingPhone: phone,
        shippingAddress: address,
        shippingPostalCode: postalCode
});

        // Restar stock (con cantidad)
        await producto.decrement('stock', { by: quantity });

        // RESPUESTA CORRECTA CON EL ID REAL
        res.status(201).json({
            success: true,
            compraId: nuevaCompra.id_compra   
        });

    } catch (error) {
        console.error('Error en compra:', error);
        res.status(500).json({ message: 'Error al procesar la compra' });
    }
});

// === Logout y Admin ===
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

app.get('/admin', isAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// === Crear admin por defecto ===
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    
    
    if (process.env.NODE_ENV !== 'production') {
        crearAdminPorDefecto();
    }
});

async function crearAdminPorDefecto() {
    const adminEmail = 'admin@gmail.com';
    const existe = await Admin.findOne({ where: { correo: adminEmail } });
    if (!existe) {
        await Admin.create({
            username: 'admin',
            correo: adminEmail,
            password: 'admin123',
            role: 'admin'
        });
        console.log('Admin creado: admin@gmail.com / admin123');
    }
}
