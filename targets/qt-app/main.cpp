// Standalone host for the Populous screen saver.
//
// Everything visual and every rule lives in QML and JavaScript, shared verbatim
// with the Plasma target. This file only decides how the application was
// started, and on Windows adopts the preview thumbnail's window.

#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QSettings>
#include <QString>
#include <QStringList>
#include <QTimer>
#include <QVariantMap>
#include <QWindow>

#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace {

// A screen saver is invoked as `/s` to run, `/c` to configure and `/p <hwnd>`
// to draw into the settings dialog's thumbnail. Windows is inconsistent about
// the separator and the case, and passes `/c:<hwnd>` in some versions.
enum class Mode {
    Run,
    Configure,
    Preview,
    Windowed,
};

struct Invocation {
    Mode mode = Mode::Configure;
    // Only meaningful for Preview: the window handle passed by Windows.
    qulonglong parentWindow = 0;
};

Invocation parseArguments(const QStringList &arguments)
{
    Invocation invocation;

    if (arguments.size() < 2) {
        // Launched with no arguments, which is how a double-click behaves.
        return invocation;
    }

    QString flag = arguments.at(1).trimmed();
    if (flag.startsWith(QLatin1Char('-')) || flag.startsWith(QLatin1Char('/'))) {
        flag.remove(0, 1);
    }

    // `/c:1234` carries its window handle after a colon.
    QString inlineValue;
    const int colon = flag.indexOf(QLatin1Char(':'));
    if (colon >= 0) {
        inlineValue = flag.mid(colon + 1);
        flag.truncate(colon);
    }

    const QString letter = flag.left(1).toLower();

    if (letter == QLatin1String("s")) {
        invocation.mode = Mode::Run;
    } else if (letter == QLatin1String("p")) {
        invocation.mode = Mode::Preview;
    } else if (letter == QLatin1String("w")) {
        // Not a Windows convention: a development affordance so the host can be
        // run in ordinary windows instead of taking over every screen.
        invocation.mode = Mode::Windowed;
    } else {
        invocation.mode = Mode::Configure;
    }

    const QString handle = inlineValue.isEmpty() && arguments.size() > 2
        ? arguments.at(2)
        : inlineValue;
    invocation.parentWindow = handle.toULongLong();

    return invocation;
}

QVariantMap loadSettings()
{
    QSettings settings;
    settings.beginGroup(QStringLiteral("General"));

    QVariantMap properties;
    // The fallbacks have to match ConfigDialog.qml's Settings defaults. When
    // they disagree, a user who never opens the dialog gets one world and a
    // user who opens it and presses OK gets another.
    properties[QStringLiteral("characterCount")] =
        qBound(10,
            settings.value(QStringLiteral("characterCount"), 150).toInt(),
            200);
    properties[QStringLiteral("armageddonSeconds")] =
        settings.value(QStringLiteral("armageddonSeconds"), 120).toInt();
    properties[QStringLiteral("spriteScaleOverride")] =
        settings.value(QStringLiteral("spriteScale"), 0).toInt();
    properties[QStringLiteral("footprintsEnabled")] =
        settings.value(QStringLiteral("footprintsEnabled"), true).toBool();
    properties[QStringLiteral("randomSeed")] =
        settings.value(QStringLiteral("randomSeed"), 0).toInt();

    settings.endGroup();
    return properties;
}

#ifdef Q_OS_WIN
// Adopts the thumbnail window the settings dialog owns, and follows it: when
// the dialog closes, that handle goes away and the screen saver must go with
// it or it lingers invisibly.
void attachToPreviewWindow(QObject *root, qulonglong handle)
{
    const auto nativeHandle = reinterpret_cast<HWND>(handle);
    if (!IsWindow(nativeHandle)) {
        qWarning("preview: %llu is not a window", handle);
        QGuiApplication::exit(1);
        return;
    }

    auto *preview = qobject_cast<QWindow *>(
        root->property("previewWindow").value<QObject *>());
    if (!preview) {
        qWarning("preview: the QML root exposes no previewWindow");
        QGuiApplication::exit(1);
        return;
    }

    RECT bounds {};
    GetClientRect(nativeHandle, &bounds);
    const int width = bounds.right - bounds.left;
    const int height = bounds.bottom - bounds.top;

    // QWindow::fromWinId plus setParent looks like the Qt-native way to do
    // this, and it reports success, but it never reparents the actual HWND.
    // Going through Win32 directly does: create the window, turn it into a
    // child, then hand it to the dialog's thumbnail.
    // Qt has to finish realising the window first: calling show() after the
    // Win32 reparenting undoes it, because Qt reapplies its own native state.
    // So show it off-screen, then take over through Win32 and never touch it
    // through Qt again.
    preview->setFlags(Qt::FramelessWindowHint | Qt::Tool);
    preview->setGeometry(-4000, -4000, width, height);
    preview->show();

    const auto child = reinterpret_cast<HWND>(preview->winId());
    if (!child) {
        qWarning("preview: the preview window has no native handle");
        QGuiApplication::exit(1);
        return;
    }

    SetWindowLongPtr(child, GWL_STYLE, WS_CHILD | WS_VISIBLE);
    if (!SetParent(child, nativeHandle)) {
        qWarning("preview: SetParent failed (%lu)", GetLastError());
        QGuiApplication::exit(1);
        return;
    }
    SetWindowPos(child, HWND_TOP, 0, 0, width, height,
                 SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED);

    // Report what actually happened rather than that the calls returned. A
    // parent that does not match means the reparenting silently came undone,
    // which is exactly what Qt's own setParent does here.
    qWarning("preview: child %llu, parent now %llu, expected %llu, %dx%d",
             reinterpret_cast<qulonglong>(child),
             reinterpret_cast<qulonglong>(GetParent(child)),
             handle, width, height);

    auto *watchdog = new QTimer(root);
    watchdog->setInterval(500);
    QObject::connect(watchdog, &QTimer::timeout, root, [nativeHandle]() {
        if (!IsWindow(nativeHandle)) {
            QGuiApplication::quit();
        }
    });
    watchdog->start();
}
#endif

} // namespace

int main(int argc, char *argv[])
{
    QGuiApplication application(argc, argv);
    QGuiApplication::setOrganizationName(QStringLiteral("poptheme"));
    QGuiApplication::setOrganizationDomain(QStringLiteral("poptheme.org"));
    QGuiApplication::setApplicationName(QStringLiteral("Populous Screen Saver"));

    const Invocation invocation = parseArguments(QGuiApplication::arguments());

    QQmlApplicationEngine engine;

    if (invocation.mode == Mode::Configure) {
        engine.load(QUrl(QStringLiteral("qrc:/ui/ConfigDialog.qml")));
        return engine.rootObjects().isEmpty() ? 1 : QGuiApplication::exec();
    }

    QVariantMap properties = loadSettings();
    properties[QStringLiteral("fullScreen")] = invocation.mode == Mode::Run;
    properties[QStringLiteral("previewMode")] = invocation.mode == Mode::Preview;

    engine.setInitialProperties(properties);
    engine.load(QUrl(QStringLiteral("qrc:/ui/main.qml")));

    if (engine.rootObjects().isEmpty()) {
        return 1;
    }

#ifdef Q_OS_WIN
    if (invocation.mode == Mode::Preview) {
        attachToPreviewWindow(engine.rootObjects().constFirst(), invocation.parentWindow);
    }
#endif

    return QGuiApplication::exec();
}
