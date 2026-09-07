using EssayGrader.App.ViewModels;
using EssayGrader.Core.Models;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Storage;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace EssayGrader.App;

public sealed partial class MainWindow : Window
{
    private readonly MainViewModel _vm;

    public MainWindow()
    {
        InitializeComponent();
        _vm = new MainViewModel(App.Services);
        EssayList.ItemsSource = _vm.Essays;
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1180, 720));
    }

    private void OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (EssayList.SelectedItem is EssayListItem item)
        {
            _vm.Selected = item;
            HeaderTitle.Text = _vm.SelectedTitle;
            HeaderMeta.Text = _vm.SelectedMeta;
            RecognizedText.Text = _vm.RecognizedText;
        }
    }

    private async void OnImportClick(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker();
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".bmp");
        picker.FileTypeFilter.Add(".webp");
        picker.SuggestedStartLocation = PickerLocationId.PicturesLibrary;
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));

        var files = await picker.PickMultipleFilesAsync();
        if (files == null) return;
        foreach (var f in files) if (f.FileName.Length == 0) { /*略*/ }

        var paths = files.Select(f => f.Path).ToList();
        _vm.AddImages(paths);
    }

    private async void OnRunClick(object sender, RoutedEventArgs e)
    {
        ProgressText.Text = "识别并校对中…";
        await _vm.RunRecognizeCorrectAsync();
        if (_vm.Selected != null)
        {
            HeaderTitle.Text = _vm.SelectedTitle;
            HeaderMeta.Text = _vm.SelectedMeta;
            RecognizedText.Text = _vm.RecognizedText;
        }
        ProgressText.Text = _vm.Progress;
    }

    private async void OnGradeClick(object sender, RoutedEventArgs e)
    {
        ProgressText.Text = "批阅中…";
        await _vm.GradeAsync();
        ProgressText.Text = _vm.Progress;
    }

    private void OnBatchClick(object sender, RoutedEventArgs e)
        => OnRunClick(sender, e);

    private async void OnExportClick(object sender, RoutedEventArgs e)
    {
        ProgressText.Text = "导出中…";
        await _vm.ExportAsync();
        ProgressText.Text = _vm.Progress;
    }
}